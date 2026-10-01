// Customer.io sync.
// Runs every hour (pg_cron) and on demand from Site admin > Settings. Tells Customer.io, from the
// server, what people are doing in the app: profile attributes (leagues, commissioner, league
// stage) and events (signed up, league created/joined, season started, draft done, episode
// scored, bug reported). Only changes are sent. Nothing is sent until the site owner turns the sync
// on; the first run after that only marks past activity as done, so nobody gets events for old things.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import {
  allEvents,
  attrsHash,
  CONFIG,
  personAttributes,
  planSend,
  type Application,
  type BugReport,
  type Contestant,
  type League,
  type Membership,
  type OutEvent,
  type Profile,
  type ScoringEvent,
  type Session,
  type Snapshot,
  type Stage,
  type Team,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE_ID = "87d8fe6f98e8d1f436f8";
const THROTTLE_MINUTES = 20;
/** Customer.io calls per run at most; anything left goes out next hour */
const MAX_CALLS_PER_RUN = 2500;
const CONCURRENCY = 6;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Read every row of a query, 1000 at a time */
async function loadAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data as T[]) || [];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** Rows whose `col` is in `ids`, in chunks (long IN lists break URLs) */
async function loadIn<T>(supabase: SupabaseClient, table: string, select: string, col: string, ids: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    out.push(...(await loadAll<T>((a, b) => supabase.from(table).select(select).in(col, chunk).range(a, b))));
  }
  return out;
}

async function loadSnapshot(supabase: SupabaseClient, now: Date): Promise<Snapshot> {
  const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "current_season").maybeSingle();
  const currentSeason = parseInt(String(setting?.value ?? "").match(/\d{1,4}/)?.[0] ?? "", 10) || null;

  const [leagues, memberships, sessions, teams, profiles] = await Promise.all([
    loadAll<League>((a, b) => supabase.from("leagues").select("id, name, owner_id, created_at, archived_at, last_activity_at, invite_code").range(a, b)),
    loadAll<Membership>((a, b) => supabase.from("league_memberships").select("league_id, user_id, role, joined_at").not("league_id", "is", null).range(a, b)),
    loadAll<Session>((a, b) =>
      supabase.from("game_sessions").select("id, league_id, season, episode, status, mode, game_type, current_draft_index, picks_per_team, created_at").range(a, b)
    ),
    loadAll<Team>((a, b) => supabase.from("league_teams").select("league_id, name, user_id").range(a, b)),
    loadAll<Profile>((a, b) => supabase.from("profiles").select("id, email, display_name, created_at").range(a, b)),
  ]);

  // Details only for each league's newest session on the current season
  const newest = new Map<string, Session>();
  for (const s of [...sessions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (s.league_id && !newest.has(s.league_id)) newest.set(s.league_id, s);
  }
  const ids = [...newest.values()].filter((s) => currentSeason !== null && s.season === currentSeason).map((s) => s.id);

  const [contestants, events, applications, order] = await Promise.all([
    loadIn<Contestant>(supabase, "contestants", "id, session_id, name, owner, is_eliminated", "session_id", ids),
    loadIn<ScoringEvent>(supabase, "scoring_events", "session_id, contestant_id, action, points, episode, created_at", "session_id", ids),
    loadIn<Application>(supabase, "episode_result_applications", "session_id, episode, skipped, applied_at", "session_id", ids),
    loadIn<{ session_id: string }>(supabase, "draft_order", "session_id", "session_id", ids),
  ]);
  const draftOrderCounts = new Map<string, number>();
  for (const r of order) draftOrderCounts.set(r.session_id, (draftOrderCounts.get(r.session_id) || 0) + 1);

  const { data: stageRows, error: stageErr } = await supabase.rpc("cio_league_stages");
  if (stageErr) throw new Error(`league stages: ${stageErr.message}`);
  const stages = new Map<string, Stage>(((stageRows as { league_id: string; stage: Stage }[]) || []).map((r) => [r.league_id, r.stage]));

  const bugReports = await loadAll<BugReport>((a, b) =>
    supabase
      .from("bug_reports")
      .select("id, user_id, description, page_url, league_id, created_at")
      .gte("created_at", CONFIG.bugReportsFrom)
      .order("created_at", { ascending: true })
      .range(a, b)
  );

  return { now, currentSeason, leagues, memberships, sessions, teams, draftOrderCounts, contestants, events, applications, profiles, stages, bugReports };
}

/** Customer.io Track API: identify (attributes) or event */
async function cio(apiKey: string, path: string, method: "PUT" | "POST", body: unknown): Promise<boolean> {
  const res = await fetch(`https://track.customer.io/api/v1/customers/${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${SITE_ID}:${apiKey}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

/** Run tasks with a small concurrency limit; returns how many succeeded */
async function pool(tasks: (() => Promise<boolean>)[]): Promise<number> {
  let ok = 0;
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) {
      const t = tasks[i++];
      try {
        if (await t()) ok++;
      } catch (_e) {
        // counted as failed; retried next run
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return ok;
}

/** Customer.io removes an attribute that's set to an empty string */
const forCio = (attrs: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v === null ? "" : v]));

const countByName = (evs: OutEvent[]) => {
  const c: Record<string, number> = {};
  for (const e of evs) c[e.name] = (c[e.name] || 0) + 1;
  return c;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const started = new Date();
  let runId: number | null = null;
  const finishLog = async (row: { ok: boolean; summary: string; details: Record<string, unknown> }) => {
    if (runId !== null) await supabase.from("cio_sync_log").update(row).eq("id", runId);
    else await supabase.from("cio_sync_log").insert({ ran_at: started.toISOString(), ...row });
  };

  try {
    // Who's asking? The hourly job sends the public key (no user); the site owner can preview or run now.
    let isOwner = false;
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: data.user.id });
        isOwner = !!sa;
      }
    }
    let body: { preview?: boolean; force?: boolean } = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    if ((body.preview || body.force) && !isOwner) return json({ error: "Site owner only" }, 403);

    const { data: enabledRow } = await supabase.from("app_settings").select("value").eq("key", "cio_sync_enabled").maybeSingle();
    const enabled = String(enabledRow?.value ?? "").toLowerCase() === "true";
    const apiKey = Deno.env.get("CIO_TRACK_API_KEY") ?? "";

    // Preview: what a run would send right now. Sends and writes nothing.
    if (body.preview) {
      const snap = await loadSnapshot(supabase, started);
      const people = personAttributes(snap);
      const events = allEvents(snap);
      const sent = new Set((await loadAll<{ event_key: string }>((a, b) => supabase.from("cio_sent_events").select("event_key").range(a, b))).map((r) => r.event_key));
      const state = new Map(
        (await loadAll<{ user_id: string; attrs_hash: string }>((a, b) => supabase.from("cio_person_state").select("user_id, attrs_hash").range(a, b))).map((r) => [r.user_id, r.attrs_hash])
      );
      const firstRun = sent.size === 0;
      const newEvents = firstRun ? [] : planSend(events.filter((e) => !sent.has(e.key))).send;
      const changed = people.filter((p) => state.get(p.userId) !== attrsHash(p.attrs));
      return json({
        ok: true,
        enabled,
        has_api_key: !!apiKey,
        first_run: firstRun,
        people: people.length,
        attribute_updates: changed.length,
        events_marked_done_first_run: firstRun ? countByName(events) : {},
        events_to_send: countByName(newEvents),
        sample_attributes: changed.slice(0, 3).map((p) => p.attrs),
        sample_events: newEvents.slice(0, 5).map((e) => ({ name: e.name, data: e.data })),
        stages: [...snap.stages.values()].reduce<Record<string, number>>((c, s) => ((c[s] = (c[s] || 0) + 1), c), {}),
      });
    }

    if (!enabled) return json({ skipped: "Customer.io sync is off" });
    if (!apiKey) return json({ error: "CIO_TRACK_API_KEY is not set" }, 500);

    // Throttle, then claim this run so a second call in the meantime hits the throttle
    const { data: lastRun } = await supabase.from("cio_sync_log").select("ran_at").order("ran_at", { ascending: false }).limit(1).maybeSingle();
    if (!body.force && lastRun?.ran_at && started.getTime() - Date.parse(lastRun.ran_at) < THROTTLE_MINUTES * 60_000) {
      return json({ skipped: "ran recently" });
    }
    const { data: claimed } = await supabase
      .from("cio_sync_log")
      .insert({ ran_at: started.toISOString(), ok: false, summary: "Syncing…", details: {} })
      .select("id")
      .single();
    runId = (claimed as { id: number } | null)?.id ?? null;

    const snap = await loadSnapshot(supabase, started);
    const people = personAttributes(snap);
    const events = allEvents(snap);
    const sent = new Set((await loadAll<{ event_key: string }>((a, b) => supabase.from("cio_sent_events").select("event_key").range(a, b))).map((r) => r.event_key));
    const state = new Map(
      (await loadAll<{ user_id: string; attrs_hash: string }>((a, b) => supabase.from("cio_person_state").select("user_id, attrs_hash").range(a, b))).map((r) => [r.user_id, r.attrs_hash])
    );
    let budget = MAX_CALLS_PER_RUN;

    // 1) Attributes first, so events land on complete profiles
    const changed = people.filter((p) => state.get(p.userId) !== attrsHash(p.attrs)).slice(0, budget);
    budget -= changed.length;
    const personDone: { user_id: string; attrs_hash: string; synced_at: string }[] = [];
    const attrsOk = await pool(
      changed.map((p) => async () => {
        const ok = await cio(apiKey, encodeURIComponent(p.userId), "PUT", forCio(p.attrs));
        if (ok) personDone.push({ user_id: p.userId, attrs_hash: attrsHash(p.attrs), synced_at: started.toISOString() });
        return ok;
      })
    );
    for (let i = 0; i < personDone.length; i += 500) {
      await supabase.from("cio_person_state").upsert(personDone.slice(i, i + 500), { onConflict: "user_id" });
    }

    // 2) Events. First run: everything that already happened is marked done, nothing is sent.
    const firstRun = sent.size === 0;
    let eventsOk = 0;
    let marked = 0;
    const fresh = events.filter((e) => !sent.has(e.key));
    if (firstRun) {
      const rows = fresh.map((e) => ({ event_key: e.key, user_id: e.userId, name: e.name, sent: false }));
      for (let i = 0; i < rows.length; i += 500) {
        await supabase.from("cio_sent_events").upsert(rows.slice(i, i + 500), { onConflict: "event_key", ignoreDuplicates: true });
      }
      marked = rows.length;
    } else {
      // Catch-up scoring: only the newest episode's recap per person; the rest are marked done
      const plan = planSend(fresh);
      const batch = plan.send.slice(0, Math.max(0, budget));
      const done: { event_key: string; user_id: string; name: string; sent: boolean }[] = plan.skip.map((e) => ({
        event_key: e.key,
        user_id: e.userId,
        name: e.name,
        sent: false,
      }));
      marked = plan.skip.length;
      eventsOk = await pool(
        batch.map((e) => async () => {
          const ok = await cio(apiKey, `${encodeURIComponent(e.userId)}/events`, "POST", { name: e.name, data: e.data });
          if (ok) done.push({ event_key: e.key, user_id: e.userId, name: e.name, sent: true });
          return ok;
        })
      );
      for (let i = 0; i < done.length; i += 500) {
        await supabase.from("cio_sent_events").upsert(done.slice(i, i + 500), { onConflict: "event_key", ignoreDuplicates: true });
      }
    }

    const toSend = firstRun ? 0 : Math.min(planSend(fresh).send.length, Math.max(0, budget));
    const failed = changed.length - attrsOk + (firstRun ? 0 : toSend - eventsOk);
    const summary = firstRun
      ? `First run: updated ${attrsOk} profiles; marked ${marked} past events as done (not sent).`
      : `Updated ${attrsOk} profiles; sent ${eventsOk} events${marked > 0 ? `; skipped ${marked} older recaps` : ""}${failed > 0 ? `; ${failed} failed, retrying next hour` : ""}.`;
    await finishLog({
      ok: failed === 0,
      summary,
      details: { first_run: firstRun, attribute_updates: attrsOk, events_sent: eventsOk, marked, failed, by_name: countByName(firstRun ? [] : fresh) },
    });
    return json({ ok: true, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await finishLog({ ok: false, summary: message, details: {} });
    } catch (_e) {
      // nothing else to do
    }
    return json({ ok: false, error: message }, 500);
  }
});
