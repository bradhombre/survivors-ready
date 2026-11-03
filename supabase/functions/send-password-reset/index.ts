// Password reset email sent through Customer.io instead of the login system's built-in email.
//
// The sign-in page calls this with { email }. If the email belongs to an account, we make a one-time
// reset link (the same kind the built-in email uses) and send Customer.io a `password_reset_requested`
// event with it; the "Password reset email" automation in Customer.io (#25) sends the email.
// The answer is the same whether or not the account exists, so this can't be used to find out who
// has an account. If anything fails we return an error and the app falls back to the built-in email.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { likeLiteral, normalizeEmail, pickRedirect, throttleDecision } from "./logic.ts";

const SITE_ID = "87d8fe6f98e8d1f436f8"; // Customer.io Track API site id (same as cio-sync)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
    console.error("send-password-reset: CIO_TRACK_API_KEY is not set");
    return json({ error: "not_configured" }, 503);
  }

  let email: string | null = null;
  try {
    email = normalizeEmail((await req.json())?.email);
  } catch {
    email = null;
  }
  if (!email) return json({ error: "invalid_email" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1. Find the account. profiles mirrors every account's id + email.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .ilike("email", likeLiteral(email))
      .limit(1)
      .maybeSingle();
    if (profileError) throw new Error(`profile lookup: ${profileError.message}`);
    if (!profile) {
      console.log("send-password-reset: no account for that email");
      return json({ ok: true });
    }

    const { data: found, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError || !found?.user) {
      console.log("send-password-reset: profile without a login account", profile.id);
      return json({ ok: true });
    }
    const user = found.user;
    const accountEmail = (user.email ?? "").toLowerCase();
    if (accountEmail !== email) {
      // The profile copy of the email is out of date; don't send to an address the account no longer uses.
      console.log("send-password-reset: profile email doesn't match the account", user.id);
      return json({ ok: true });
    }

    // 2. At most one email a minute and five an hour per account. Checked before making a link,
    // because a new link cancels the one in the email they already have.
    const now = Date.now();
    const throttle = throttleDecision(user.app_metadata?.pw_reset_sends, now);
    if (!throttle.allowed) {
      console.log("send-password-reset: throttled", user.id);
      return json({ ok: true });
    }

    // 3. Make the one-time link (this does not send an email itself).
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: accountEmail,
      options: { redirectTo: pickRedirect(req.headers.get("origin")) },
    });
    const resetUrl = link?.properties?.action_link;
    if (linkError || !resetUrl) throw new Error(`generateLink: ${linkError?.message ?? "no link"}`);

    // 4. Remember this send for the throttle.
    const { error: metaError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { pw_reset_sends: throttle.next },
    });
    if (metaError) console.error("send-password-reset: couldn't record the send", user.id, metaError.message);

    // 5. Customer.io: make sure the profile has the email, then send the event that triggers the email.
    const identified = await cio(apiKey, encodeURIComponent(user.id), "PUT", { email: accountEmail });
    const sent = identified &&
      (await cio(apiKey, `${encodeURIComponent(user.id)}/events`, "POST", {
        name: "password_reset_requested",
        data: { reset_url: resetUrl, requested_at: new Date(now).toISOString() },
      }));
    if (!sent) throw new Error("Customer.io didn't accept the event");

    console.log("send-password-reset: sent", user.id);
    return json({ ok: true });
  } catch (err) {
    console.error("send-password-reset failed:", err instanceof Error ? err.message : err);
    return json({ error: "send_failed" }, 502);
  }
});
