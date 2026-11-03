// Email-and-password sign-up whose confirmation email goes out through Customer.io.
//
// The sign-up form calls this with { email, password, redirectPath }. We create the account (or, for
// an account that signed up before but never confirmed, make a fresh link), then send Customer.io a
// `signup_confirmation_requested` event with the one-time confirmation link; the "Confirm your email
// (sign-up)" automation in Customer.io (#26) sends the email. Making the link this way does not send
// the login system's own email.
//
// Same answer whether or not the email already has an account. Limits: 5 attempts per IP per
// 10 minutes (429, shown to the person), 1 confirmation email a minute and 5 an hour per account,
// and above 40 new accounts in an hour we step aside (503) so the app falls back to the login
// system's own sign-up and its limits. Any other failure returns 502 and the app falls back too.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  HOURLY_SIGNUP_CEILING,
  clientIp,
  ipAllowed,
  likeLiteral,
  normalizeEmail,
  pickConfirmRedirect,
  resendDecision,
  validPassword,
} from "./logic.ts";

const SITE_ID = "87d8fe6f98e8d1f436f8"; // Customer.io Track API site id (same as cio-sync)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ipLog = new Map<string, number[]>();

async function cio(apiKey: string, path: string, method: "PUT" | "POST", body: unknown): Promise<boolean> {
  const res = await fetch(`https://track.customer.io/api/v1/customers/${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${SITE_ID}:${apiKey}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("CIO_TRACK_API_KEY") ?? "";
  if (!apiKey) {
    console.error("email-sign-up: CIO_TRACK_API_KEY is not set");
    return json({ error: "not_configured" }, 503);
  }

  let input: { email?: unknown; password?: unknown; redirectPath?: unknown } = {};
  try {
    input = (await req.json()) ?? {};
  } catch {
    input = {};
  }
  const email = normalizeEmail(input.email);
  if (!email) return json({ error: "invalid_email", message: "Invalid email address" }, 400);
  if (!validPassword(input.password)) {
    return json({ error: "weak_password", message: "Password must be at least 6 characters" }, 400);
  }
  const password = input.password;

  const now = Date.now();
  if (!ipAllowed(ipLog, clientIp(req.headers.get("x-forwarded-for"), req.headers.get("x-real-ip")), now)) {
    return json({ error: "rate_limited", message: "Too many sign-up attempts. Please wait a few minutes and try again." }, 429);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1. Busy hour? Step aside so the login system's own sign-up (and its limits) takes over.
    const { count, error: countError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(now - 60 * 60_000).toISOString());
    if (countError) throw new Error(`signup count: ${countError.message}`);
    if ((count ?? 0) >= HOURLY_SIGNUP_CEILING) {
      console.warn("email-sign-up: over the hourly ceiling, handing off", count);
      return json({ error: "busy" }, 503);
    }

    // 2. Existing account? Confirmed ones get nothing (same answer as a new one); unconfirmed ones get
    // a fresh link, at most once a minute and five times an hour.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", likeLiteral(email))
      .limit(1)
      .maybeSingle();
    if (profileError) throw new Error(`profile lookup: ${profileError.message}`);

    let previousSends: unknown = undefined;
    if (profile) {
      const { data: found, error: userError } = await admin.auth.admin.getUserById(profile.id);
      if (userError || !found?.user) throw new Error(`user lookup: ${userError?.message ?? "missing"}`);
      if ((found.user.email ?? "").toLowerCase() === email) {
        if (found.user.email_confirmed_at) {
          console.log("email-sign-up: already confirmed", found.user.id);
          return json({ ok: true });
        }
        previousSends = found.user.app_metadata?.signup_confirm_sends;
        if (!resendDecision(previousSends, now).allowed) {
          console.log("email-sign-up: resend throttled", found.user.id);
          return json({ ok: true });
        }
      }
    }

    // 3. Create the account (or refresh an unconfirmed one) and get the one-time confirmation link.
    // For an existing unconfirmed account the login system keeps its password unchanged.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { redirectTo: pickConfirmRedirect(req.headers.get("origin"), input.redirectPath) },
    });
    if (linkError) {
      const code = (linkError as { code?: string }).code ?? "";
      if (code === "email_exists" || /already been registered/i.test(linkError.message)) return json({ ok: true });
      if (code === "weak_password" || /password/i.test(linkError.message)) {
        return json({ error: "weak_password", message: linkError.message }, 400);
      }
      throw new Error(`generateLink: ${linkError.message}`);
    }
    const confirmUrl = link?.properties?.action_link;
    const user = link?.user;
    if (!confirmUrl || !user) throw new Error("generateLink: no link");

    // 4. Remember this send for the resend limit.
    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { signup_confirm_sends: resendDecision(previousSends ?? user.app_metadata?.signup_confirm_sends, now).next },
    });
    if (metaError) console.error("email-sign-up: couldn't record the send", user.id, metaError.message);

    // 5. Customer.io: put the email on the profile, then send the event that triggers the email.
    const identified = await cio(apiKey, encodeURIComponent(user.id), "PUT", { email });
    const sent = identified &&
      (await cio(apiKey, `${encodeURIComponent(user.id)}/events`, "POST", {
        name: "signup_confirmation_requested",
        data: { confirm_url: confirmUrl, requested_at: new Date(now).toISOString() },
      }));
    if (!sent) throw new Error("Customer.io didn't accept the event");

    console.log("email-sign-up: confirmation sent", user.id);
    return json({ ok: true });
  } catch (err) {
    console.error("email-sign-up failed:", err instanceof Error ? err.message : err);
    return json({ error: "send_failed" }, 502);
  }
});
