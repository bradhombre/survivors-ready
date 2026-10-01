// Pure logic for the Customer.io sync (no Deno or network APIs, so it can be tested with Node).
// index.ts reads the database, calls these, and sends what's new to Customer.io.

export type League = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  archived_at: string | null;
  last_activity_at: string | null;
  invite_code: string | null;
};
export type Membership = { league_id: string; user_id: string; role: string; joined_at: string | null };
export type Session = {
  id: string;
  league_id: string | null;
  season: number;
  episode: number;
  status: string;
  mode: string;
  game_type: string;
  current_draft_index: number;
  picks_per_team: number | null;
  created_at: string;
};
export type Team = { league_id: string; name: string; user_id: string | null };
export type Contestant = { id: string; session_id: string; name: string; owner: string | null; is_eliminated: boolean };
export type ScoringEvent = {
  session_id: string;
  contestant_id: string | null;
  action: string;
  points: number;
  episode: number;
  created_at: string;
};
export type Application = { session_id: string; episode: number; skipped: boolean; applied_at: string };
export type Profile = { id: string; email: string | null; display_name: string | null; created_at: string };
export type BugReport = {
  id: string;
  user_id: string | null;
  description: string;
  page_url: string | null;
  league_id: string | null;
  created_at: string;
};

export type Snapshot = {
  now: Date;
  currentSeason: number | null;
  leagues: League[];
  memberships: Membership[];
  sessions: Session[];
  teams: Team[];
  draftOrderCounts: Map<string, number>; // session_id -> number of draft slots
  contestants: Contestant[]; // current sessions only
  events: ScoringEvent[]; // current-season sessions only
  applications: Application[];
  profiles: Profile[];
  /** league_id -> stage, from the database (same rules as Site admin > Leagues) */
  stages: Map<string, Stage>;
  /** Bug reports filed since CONFIG.bugReportsFrom */
  bugReports: BugReport[];
};

export type Stage =
  | "playing"
  | "stopped_scoring"
  | "needs_scoring"
  | "ready_to_draft"
  | "needs_players"
  | "not_rolled_over"
  | "fizzled"
  | "never_started";

export type OutEvent = { key: string; userId: string; name: string; data: Record<string, unknown> };
export type PersonAttrs = { userId: string; attrs: Record<string, string | number | boolean | null> };

export const CONFIG = {
  /** A hand-scored episode counts as done once it has this many events... */
  minEventsForScored: 3,
  /** ...and nothing new was added for this long */
  scoredQuietHours: 12,
  /**
   * Bug reports go to Brad by email ("Bug report → Brad" in Customer.io, event bug_reported).
   * Sent from here, not the browser, because ad blockers stopped the browser event. Only reports
   * filed after this switch-over are sent; older ones are in Site admin > Bugs.
   */
  bugReportsFrom: "2026-10-01T04:30:00Z",
};

const EXIT_RE = /(voted\s*out|quit|medevac|removed)/i;

/** The newest session of each league (same rule as Site admin league health) */
export function currentSessions(sessions: Session[]): Map<string, Session> {
  const out = new Map<string, Session>();
  for (const s of [...sessions].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (s.league_id && !out.has(s.league_id)) out.set(s.league_id, s);
  }
  return out;
}

/** Castaways the draft is sized on (drafted ones always count), same as the app */
const poolSize = (cs: Contestant[]) => cs.filter((c) => !!c.owner || !c.is_eliminated).length;

export function isDraftComplete(s: Session, cast: Contestant[], slots: number): boolean {
  if (s.game_type === "winner_takes_all") return cast.some((c) => c.owner) && s.current_draft_index >= slots && slots > 0;
  if (slots <= 0) return false;
  const ppt = s.picks_per_team ?? Math.max(1, Math.floor(poolSize(cast) / slots));
  return s.current_draft_index >= slots * ppt;
}

/** Profile attributes for everyone with an account */
export function personAttributes(snap: Snapshot): PersonAttrs[] {
  const stages = snap.stages;
  const cur = currentSessions(snap.sessions);
  const leagueById = new Map(snap.leagues.map((l) => [l.id, l]));
  const live = (id: string) => {
    const l = leagueById.get(id);
    return !!l && !l.archived_at;
  };
  const memberCount = countBy(snap.memberships, (m) => m.league_id);
  const byUser = groupBy(snap.memberships.filter((m) => live(m.league_id)), (m) => m.user_id);

  return snap.profiles.map((p) => {
    const mine = byUser.get(p.id) || [];
    const owned = snap.leagues.filter((l) => l.owner_id === p.id && !l.archived_at);
    const adminOf = mine.filter((m) => m.role === "league_admin").map((m) => m.league_id);
    const commissionerOf = [...new Set([...owned.map((l) => l.id), ...adminOf])];
    const activeLeague = mine.some((m) => {
      const s = cur.get(m.league_id);
      return !!s && snap.currentSeason !== null && s.season === snap.currentSeason && s.status !== "completed";
    });
    // The league a commissioner most likely needs a nudge about: current season first, newest first
    const pick = [...owned].sort((a, b) => {
      const ca = cur.get(a.id)?.season === snap.currentSeason ? 1 : 0;
      const cb = cur.get(b.id)?.season === snap.currentSeason ? 1 : 0;
      return cb - ca || Date.parse(b.created_at) - Date.parse(a.created_at);
    })[0];
    const first = (p.display_name || "").trim().split(/\s+/)[0] || null;
    return {
      userId: p.id,
      attrs: {
        ...(p.email ? { email: p.email } : {}),
        display_name: p.display_name || null,
        first_name: first,
        leagues_count: mine.length,
        leagues_owned: owned.length,
        is_commissioner: commissionerOf.length > 0,
        has_active_league: activeLeague,
        league_stage: pick ? stages.get(pick.id) || null : null,
        league_id: pick ? pick.id : null,
        league_name: pick ? pick.name : null,
        league_members: pick ? memberCount.get(pick.id) || 0 : null,
      },
    };
  });
}

/** Stable hash of an attribute set (only changes are sent) */
export function attrsHash(a: Record<string, unknown>): string {
  const s = JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]]));
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Everything that has happened, as events with a unique key. index.ts sends only keys it hasn't
 * sent before (the first run marks them all as sent without sending).
 */
export function allEvents(snap: Snapshot): OutEvent[] {
  const out: OutEvent[] = [];
  const leagueById = new Map(snap.leagues.map((l) => [l.id, l]));
  const cur = currentSessions(snap.sessions);
  const teamsByLeague = groupBy(snap.teams, (t) => t.league_id);
  const membersByLeague = groupBy(snap.memberships, (m) => m.league_id);
  const castBySession = groupBy(snap.contestants, (c) => c.session_id);
  const eventsBySession = groupBy(snap.events, (e) => e.session_id);
  const appsBySession = groupBy(snap.applications, (a) => a.session_id);
  const profileIds = new Set(snap.profiles.map((p) => p.id));

  for (const p of snap.profiles) {
    out.push({ key: `user_signed_up:${p.id}`, userId: p.id, name: "user_signed_up", data: {} });
  }

  // Each new bug report, on the reporter's profile (the automation emails it to Brad)
  const profileById = new Map(snap.profiles.map((p) => [p.id, p]));
  const from = Date.parse(CONFIG.bugReportsFrom);
  for (const b of snap.bugReports) {
    const reporter = b.user_id ? profileById.get(b.user_id) : undefined;
    if (!reporter || Date.parse(b.created_at) < from) continue;
    out.push({
      key: `bug_reported:${b.id}`,
      userId: reporter.id,
      name: "bug_reported",
      data: {
        description: b.description,
        page_url: b.page_url,
        league_id: b.league_id,
        league_name: b.league_id ? leagueById.get(b.league_id)?.name ?? null : null,
        reporter_email: reporter.email,
        reporter_name: reporter.display_name,
        reported_at: b.created_at,
      },
    });
  }

  for (const l of snap.leagues) {
    if (l.archived_at) continue;
    const base = { league_id: l.id, league_name: l.name };
    if (profileIds.has(l.owner_id)) {
      out.push({
        key: `league_created:${l.id}`,
        userId: l.owner_id,
        name: "league_created",
        data: { ...base, invite_code: l.invite_code, invite_url: l.invite_code ? `https://survivorsready.com/join/${l.invite_code}` : null },
      });
    }
    for (const m of membersByLeague.get(l.id) || []) {
      if (m.user_id === l.owner_id || !profileIds.has(m.user_id)) continue;
      out.push({ key: `league_joined:${l.id}:${m.user_id}`, userId: m.user_id, name: "league_joined", data: base });
    }

    const s = cur.get(l.id);
    if (!s || snap.currentSeason === null || s.season !== snap.currentSeason) continue;
    const members = (membersByLeague.get(l.id) || []).filter((m) => profileIds.has(m.user_id));
    const seasonData = { ...base, season: s.season };

    for (const m of members) {
      out.push({ key: `season_started:${s.id}:${m.user_id}`, userId: m.user_id, name: "season_started", data: seasonData });
    }

    const cast = castBySession.get(s.id) || [];
    const teams = teamsByLeague.get(l.id) || [];
    const teamOf = (userId: string) => teams.find((t) => t.user_id === userId)?.name || null;
    const slots = snap.draftOrderCounts.get(s.id) || teams.length;
    if (isDraftComplete(s, cast, slots)) {
      for (const m of members) {
        const team = teamOf(m.user_id);
        out.push({
          key: `draft_completed:${s.id}:${m.user_id}`,
          userId: m.user_id,
          name: "draft_completed",
          data: {
            ...seasonData,
            team_name: team,
            castaways: team ? cast.filter((c) => c.owner === team).map((c) => c.name) : [],
          },
        });
      }
    }

    // Episodes this league has finished scoring
    const evs = eventsBySession.get(s.id) || [];
    const apps = (appsBySession.get(s.id) || []).filter((a) => !a.skipped);
    for (const ep of scoredEpisodes(evs, apps, snap.now)) {
      const standings = standingsAfter(evs, cast, ep);
      for (const m of members) {
        const team = teamOf(m.user_id);
        const row = team ? standings.find((r) => r.team === team) : undefined;
        out.push({
          key: `episode_scored:${s.id}:${ep}:${m.user_id}`,
          userId: m.user_id,
          name: "episode_scored",
          data: {
            ...seasonData,
            episode: ep,
            team_name: team,
            rank: row?.rank ?? null,
            teams: standings.length,
            total_points: row?.total ?? 0,
            episode_points: row?.episode ?? 0,
            leader_team: standings[0]?.team ?? null,
            leader_points: standings[0]?.total ?? 0,
            castaways_lost: row?.lost ?? [],
          },
        });
      }
    }
  }
  return out;
}

/** Episodes a league is done scoring: applied from the results card, or hand-scored and quiet. */
export function scoredEpisodes(evs: ScoringEvent[], apps: Application[], now: Date): number[] {
  const done = new Set(apps.map((a) => a.episode));
  const byEp = groupBy(evs, (e) => String(e.episode));
  for (const [ep, list] of byEp) {
    const newest = Math.max(...list.map((e) => Date.parse(e.created_at) || 0));
    if (list.length >= CONFIG.minEventsForScored && now.getTime() - newest >= CONFIG.scoredQuietHours * 36e5) done.add(Number(ep));
  }
  return [...done].filter((n) => n >= 1).sort((a, b) => a - b);
}

/** Team standings counting events through episode `ep` */
export function standingsAfter(evs: ScoringEvent[], cast: Contestant[], ep: number) {
  const ownerOf = new Map(cast.map((c) => [c.id, c.owner]));
  const nameOf = new Map(cast.map((c) => [c.id, c.name]));
  const teams = [...new Set(cast.map((c) => c.owner).filter((o): o is string => !!o))];
  const rows = teams.map((team) => {
    let total = 0;
    let episode = 0;
    const lost: string[] = [];
    for (const e of evs) {
      if (!e.contestant_id || ownerOf.get(e.contestant_id) !== team || e.episode > ep) continue;
      total += e.points;
      if (e.episode === ep) {
        episode += e.points;
        if (EXIT_RE.test(e.action)) {
          const n = nameOf.get(e.contestant_id);
          if (n && !lost.includes(n)) lost.push(n);
        }
      }
    }
    return { team, total, episode, lost, rank: 0 };
  });
  rows.sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
  rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1));
  return rows;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function countBy<T>(xs: T[], key: (x: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return m;
}
