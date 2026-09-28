// Automatic episode results.
// Runs every hour (pg_cron) and on demand from Site admin > Episodes ("Check the wikis now").
// Reads the season's Survivor Wiki and Wikipedia pages, turns their results tables into the same
// facts the site owner would enter, and publishes an episode when the sources agree and have
// been steady (see logic.ts). Commissioners still choose when to apply it to their league,
// which is the spoiler gate for leagues that watch later.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import {
  CONFIG,
  decide,
  factsKey,
  hashText,
  htmlTablesToText,
  validateSource,
  type Candidate,
  type RawEpisode,
  type SourceFacts,
  type SourceName,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const UA = "SurvivorsReadyBot/1.0 (https://survivorsready.com; fan fantasy league, reads episode results)";
const THROTTLE_MINUTES = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function fetchPageHtml(source: SourceName, season: number): Promise<string> {
  const api =
    source === "wikipedia"
      ? `https://en.wikipedia.org/w/api.php?action=parse&page=Survivor_${season}&prop=text&redirects=1&format=json&formatversion=2`
      : `https://survivor.fandom.com/api.php?action=parse&page=Survivor_${season}&prop=text&redirects=1&format=json&formatversion=2`;
  try {
    const res = await fetch(api, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const html = data?.parse?.text;
      if (typeof html === "string" && html.length > 500) return html;
    }
  } catch (_e) {
    // fall through to Firecrawl for the Survivor Wiki
  }
  if (source === "survivor_wiki") {
    const key = Deno.env.get("FIRECRAWL_API_KEY");
    if (!key) throw new Error("Survivor Wiki fetch failed and no Firecrawl key");
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://survivor.fandom.com/wiki/Survivor_${season}`, formats: ["html"] }),
    });
    if (!res.ok) throw new Error(`Firecrawl ${res.status}`);
    const data = await res.json();
    const html = data?.data?.html || data?.html;
    if (typeof html === "string" && html.length > 500) return html;
  }
  throw new Error(`${source} page not found`);
}

async function extractWithAI(source: SourceName, season: number, castNames: string[], text: string): Promise<RawEpisode[]> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("AI key not configured");
  const instructions = `You read Survivor wiki tables and report episode results as JSON. Season ${season}. Source: ${
    source === "wikipedia" ? "Wikipedia" : "the Survivor Wiki"
  }.
Official cast (always use these exact spellings): ${castNames.join("; ")}.
Map nicknames and short names to the official name (a table may say "Kilby" for "Danny Kilby").

Return ONLY this JSON object and nothing else:
{"episodes":[{"episode":1,"air_date":"YYYY-MM-DD","voted_out":[],"quit":[],"medevac":[],"individual_immunity":[],"merged":false,"first_juror_voted_out":false,"final_tribal":[],"winner":null,"uncertain":[]}]}

Rules:
- Include an episode only if it has aired AND its eliminations are filled in. Skip rows that are blank or say TBD.
- voted_out: castaways eliminated at Tribal Council that episode (by votes, rocks, or losing fire-making).
- quit: castaways who chose to leave. medevac: castaways medically evacuated or removed by production.
- individual_immunity: castaways who individually won immunity that episode, listed once per immunity challenge won. A finale or double episode can have several; if the same castaway won two, list them twice. If a TRIBE won immunity, leave it out. Never put tribe names here. A name in [brackets] next to the winner is someone they chose to share a reward or took to the end, not an immunity winner.
- merged: true if the tribes had merged by this episode (one merged tribe).
- first_juror_voted_out: true only if a castaway eliminated in this episode became the FIRST member of the jury.
- The finale often covers several Tribal Councils in one episode: list everyone eliminated in it (including the fire-making loser) in voted_out, every individual immunity winner, the finalists in final_tribal and the Sole Survivor in winner.
- final_tribal and winner: only for the finale episode. Ignore any reunion or aftershow listed after it.
- A two-hour episode shown as one row in the table is one episode.
- If anything is unclear or the tables contradict each other, add a short note to "uncertain" for that episode instead of guessing.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "openai/gpt-6-astra", instructions, input: text }),
  });
  if (!res.ok) throw new Error(`AI extraction failed [${res.status}]`);
  const ai = await res.json();
  let out: string = ai.output_text || "";
  if (!out && Array.isArray(ai.output)) {
    for (const o of ai.output) for (const c of o.content || []) if (c.text) out += c.text;
  }
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) return [];
  const parsed = JSON.parse(m[0]);
  return Array.isArray(parsed?.episodes) ? (parsed.episodes as RawEpisode[]) : [];
}

async function notifyOwner(
  supabase: SupabaseClient,
  data: { season: number; episode: number; status: string; message: string }
) {
  const apiKey = Deno.env.get("CIO_TRACK_API_KEY");
  if (!apiKey) return;
  const { data: owner } = await supabase
    .from("league_memberships")
    .select("user_id")
    .eq("role", "super_admin")
    .is("league_id", null)
    .limit(1)
    .maybeSingle();
  if (!owner?.user_id) return;
  const creds = btoa(`87d8fe6f98e8d1f436f8:${apiKey}`);
  await fetch(`https://track.customer.io/api/v1/customers/${owner.user_id}/events`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "episode_results_update", data: { ...data, admin_url: "https://survivorsready.com/admin" } }),
  }).catch(() => {});
}

/**
 * Test on a past season (site owner only). Reads both wikis for that season and replays it in
 * order, as if each episode had just aired and both pages had been steady for hours, so you can
 * see exactly what would be published. Writes nothing to the database.
 */
async function testSeason(supabase: SupabaseClient, season: number) {
  if (!Number.isInteger(season) || season < 1) return { ok: false, error: "Pick a season number" };
  const { data: castRows } = await supabase.from("master_contestants").select("name").eq("season_number", season);
  const castNames = (castRows || []).map((r: { name: string }) => r.name);
  if (castNames.length === 0) return { ok: false, error: `No official cast for Season ${season}. Add it in the Cast tab first.` };

  const sources: SourceName[] = ["survivor_wiki", "wikipedia"];
  const facts: Record<SourceName, SourceFacts | null> = { survivor_wiki: null, wikipedia: null };
  const notes: Record<string, string> = {};
  for (const source of sources) {
    try {
      const text = htmlTablesToText(await fetchPageHtml(source, season)).slice(0, 30000);
      const raw = await extractWithAI(source, season, castNames, text);
      facts[source] = validateSource(source, raw, castNames);
      notes[source] = `read ${raw.length} episodes`;
    } catch (e) {
      notes[source] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const wiki = facts.survivor_wiki;
  if (!wiki) return { ok: false, season, notes };

  const eps = [
    ...new Set(
      sources.flatMap((s) => (facts[s] ? [...facts[s]!.episodes.keys(), ...facts[s]!.problems.keys()] : []))
    ),
  ].sort((a, b) => a - b);
  const longAgo = "2000-01-01T00:00:00Z";
  const candidates = new Map<string, Candidate>();
  for (const s of sources) for (const ep of eps) candidates.set(`${s}:${ep}`, { hash: "", first_seen_at: longAgo });
  const now = new Date("2100-01-01T00:00:00Z");

  let merged = false;
  const episodes = [];
  for (const ep of eps) {
    const published = new Set(Array.from({ length: ep - 1 }, (_, i) => i + 1));
    const [d] = decide({ wiki, wikipedia: facts.wikipedia, candidates, published, manual: new Set(), lastPublishedPostMerge: merged, now });
    const w = wiki.episodes.get(ep) || null;
    const wp = facts.wikipedia?.episodes.get(ep) || null;
    episodes.push({
      episode: ep,
      result: d?.action ?? "skipped",
      why: !d ? "Not listed by the Survivor Wiki" : d.action === "publish" ? d.note : d.reason,
      facts: d?.action === "publish" ? d.facts : w,
      wikipedia_says: wp && w && factsKey(wp) !== factsKey(w) ? wp : undefined,
    });
    merged = d?.action === "publish" ? d.facts.post_merge : merged || !!w?.post_merge;
  }
  return { ok: true, season, notes, episodes };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false },
  });
  const started = new Date();

  try {
    // Who's asking? The hourly job sends the public key (no user); the site owner can force a run.
    let isOwner = false;
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      if (data?.user) {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: data.user.id });
        isOwner = !!sa;
      }
    }
    let body: { force?: boolean; test_season?: number } = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    const force = !!body.force && isOwner;

    if (body.test_season !== undefined) {
      if (!isOwner) return json({ error: "Site owner only" }, 403);
      return json(await testSeason(supabase, Number(body.test_season)));
    }

    // Throttle so nobody can run up the AI and scraping bill
    const { data: lastRun } = await supabase
      .from("episode_sync_log")
      .select("ran_at")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!force && lastRun?.ran_at && started.getTime() - Date.parse(lastRun.ran_at) < THROTTLE_MINUTES * 60_000) {
      return json({ skipped: "ran recently" });
    }

    const { data: setting } = await supabase.from("app_settings").select("value").eq("key", "current_season").maybeSingle();
    const season = parseInt(String(setting?.value ?? "").match(/\d{1,4}/)?.[0] ?? "", 10);
    if (!season) return json({ error: "No current season set" }, 400);

    const { data: castRows } = await supabase.from("master_contestants").select("name").eq("season_number", season);
    const castNames = (castRows || []).map((r: { name: string }) => r.name);
    if (castNames.length === 0) return json({ error: `No official cast for Season ${season}` }, 400);

    // Read both sources; re-ask the AI only when a page's results tables actually changed
    const sources: SourceName[] = ["survivor_wiki", "wikipedia"];
    const facts: Record<SourceName, SourceFacts | null> = { survivor_wiki: null, wikipedia: null };
    const fetchNotes: Record<string, string> = {};
    for (const source of sources) {
      try {
        const html = await fetchPageHtml(source, season);
        const text = htmlTablesToText(html).slice(0, 30000);
        const contentHash = hashText(text);
        const { data: state } = await supabase
          .from("episode_sync_state")
          .select("content_hash, raw")
          .eq("season", season)
          .eq("source", source)
          .maybeSingle();
        let raw: RawEpisode[];
        if (state?.content_hash === contentHash && Array.isArray(state.raw)) {
          raw = state.raw as RawEpisode[];
          fetchNotes[source] = "unchanged";
        } else {
          raw = await extractWithAI(source, season, castNames, text);
          await supabase.from("episode_sync_state").upsert(
            { season, source, content_hash: contentHash, raw, updated_at: started.toISOString() },
            { onConflict: "season,source" }
          );
          fetchNotes[source] = `read ${raw.length} episodes`;
        }
        facts[source] = validateSource(source, raw, castNames);
      } catch (e) {
        fetchNotes[source] = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (!facts.survivor_wiki) {
      await supabase.from("episode_sync_log").insert({ ran_at: started.toISOString(), ok: false, summary: "Couldn't read the Survivor Wiki", details: { fetchNotes } });
      return json({ ok: false, fetchNotes });
    }

    // Track when each source's answer for each episode last changed
    const { data: candRows } = await supabase.from("episode_result_candidates").select("source, episode, hash, first_seen_at").eq("season", season);
    const candidates = new Map<string, Candidate>();
    for (const r of candRows || []) candidates.set(`${r.source}:${r.episode}`, { hash: r.hash, first_seen_at: r.first_seen_at });
    for (const source of sources) {
      const sf = facts[source];
      if (!sf) continue;
      for (const [ep, f] of sf.episodes) {
        const hash = hashText(factsKey(f));
        const k = `${source}:${ep}`;
        if (candidates.get(k)?.hash !== hash) {
          const row = { season, source, episode: ep, hash, facts: f, first_seen_at: started.toISOString() };
          await supabase.from("episode_result_candidates").upsert(row, { onConflict: "season,source,episode" });
          candidates.set(k, { hash, first_seen_at: row.first_seen_at });
        }
      }
    }

    // What's already live, and what the site owner is editing by hand
    const { data: existing } = await supabase.from("episode_results").select("episode, status, post_merge").eq("season", season);
    const published = new Set<number>();
    const manual = new Set<number>();
    let lastPublishedPostMerge = false;
    let maxEp = 0;
    for (const r of existing || []) {
      if (r.status === "published") {
        published.add(r.episode);
        if (r.episode > maxEp) {
          maxEp = r.episode;
          lastPublishedPostMerge = !!r.post_merge;
        }
      } else manual.add(r.episode);
    }

    const decisions = decide({
      wiki: facts.survivor_wiki,
      wikipedia: facts.wikipedia,
      candidates,
      published,
      manual,
      lastPublishedPostMerge,
      now: started,
    });

    for (const d of decisions) {
      if (d.action !== "publish") continue;
      const f = d.facts;
      const { error } = await supabase.from("episode_results").upsert(
        {
          season,
          episode: d.episode,
          voted_out: f.voted_out,
          quit: f.quit,
          left_game: f.left_game,
          immunity: f.immunity,
          post_merge: f.post_merge,
          jury_starts: f.jury_starts,
          final_tribal: f.final_tribal,
          winner: f.winner,
          status: "published",
          published_at: started.toISOString(),
          source: "auto",
          auto_note: d.note,
          updated_at: started.toISOString(),
        },
        { onConflict: "season,episode", ignoreDuplicates: true }
      );
      if (!error) await notifyOwner(supabase, { season, episode: d.episode, status: "published", message: d.note });
    }

    // Tell the owner once when something needs a look (not every hour)
    const { data: prev } = await supabase
      .from("episode_sync_log")
      .select("details")
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevReview = (prev?.details as { review?: string } | null)?.review || "";
    const review = decisions.find((d) => d.action === "review");
    const reviewKey = review ? `${review.episode}:${(review as { reason: string }).reason}` : "";
    if (review && reviewKey !== prevReview) {
      await notifyOwner(supabase, { season, episode: review.episode, status: "needs_review", message: (review as { reason: string }).reason });
    }

    const summary =
      decisions
        .map((d) =>
          d.action === "publish"
            ? `Episode ${d.episode} published automatically (${d.note})`
            : `Episode ${d.episode}: ${(d as { reason: string }).reason}`
        )
        .join(" ") || "Nothing new to publish.";
    await supabase.from("episode_sync_log").insert({
      ran_at: started.toISOString(),
      ok: true,
      summary,
      details: {
        fetchNotes,
        review: reviewKey,
        problems: Object.fromEntries(
          sources.map((s) => [s, facts[s] ? Object.fromEntries(facts[s]!.problems) : "not read"])
        ),
        config: CONFIG,
      },
    });
    return json({ ok: true, season, summary, decisions: decisions.map((d) => ({ episode: d.episode, action: d.action })) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await supabase.from("episode_sync_log").insert({ ran_at: started.toISOString(), ok: false, summary: message, details: {} });
    } catch (_e) {
      // nothing else to do
    }
    return json({ ok: false, error: message }, 500);
  }
});
