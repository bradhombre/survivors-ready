// Episode results v1 (auto-scoring).
// The site owner enters each episode's big facts once; this file turns them into the scoring
// events a league is missing. Pure functions only (no database), so the rules are easy to test.

import { SCORING_ACTIONS, type Contestant, type ScoringEvent } from "@/types/survivor";
import { getPoints, isActionEnabled } from "@/lib/scoring";
import type { ScoringConfig } from "@/lib/scoring";

export type EpisodeResult = {
  id?: string;
  season: number;
  episode: number;
  voted_out: string[];
  quit: string[];
  immunity: string[];
  post_merge: boolean;
  jury_starts: boolean;
  final_tribal: string[];
  winner: string | null;
  status?: "draft" | "published";
  published_at?: string | null;
  updated_at?: string;
};

export type ActionKey = keyof typeof SCORING_ACTIONS;

export type PlannedEvent = {
  contestantId: string;
  contestantName: string;
  owner: string | null;
  key: ActionKey;
  action: string;
  points: number;
};

export type EpisodePlan = {
  episode: number;
  events: PlannedEvent[];
  /** Contestant ids to mark as out */
  eliminate: string[];
  /** Names from the results that aren't in this league's cast */
  unmatched: string[];
  /** Events that were already entered by hand and are skipped */
  alreadyEntered: number;
  postMerge: boolean;
};

/** Lowercase, no accents, letters and digits only ("Thien An Nguyen" -> "thienannguyen"). */
export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Matches a scoring event's saved text to an action, ignoring emoji and spacing. */
const normalizeAction = normalizeName;

const labelOf = (key: ActionKey) => SCORING_ACTIONS[key].label;

/** Build a lookup from a results name to this league's contestant. */
export function makeMatcher(contestants: Contestant[]) {
  const byFull = new Map<string, Contestant>();
  const byLast = new Map<string, Contestant[]>();
  for (const c of contestants) {
    byFull.set(normalizeName(c.name), c);
    const parts = c.name.trim().split(/\s+/);
    const last = normalizeName(parts[parts.length - 1] || "");
    if (last) byLast.set(last, [...(byLast.get(last) || []), c]);
  }
  return (name: string): Contestant | undefined => {
    const exact = byFull.get(normalizeName(name));
    if (exact) return exact;
    // Fallback: same last name and same first initial, only if that's unique in the league
    const parts = name.trim().split(/\s+/);
    const last = normalizeName(parts[parts.length - 1] || "");
    const initial = normalizeName(parts[0] || "").charAt(0);
    const candidates = (byLast.get(last) || []).filter((c) => normalizeName(c.name).charAt(0) === initial);
    return candidates.length === 1 ? candidates[0] : undefined;
  };
}

/**
 * Everything a league needs added for one episode.
 * `published` is every published result for the season (any order); earlier episodes decide who
 * was already out, so a league that fell behind never gets survival points for a castaway who left.
 */
export function buildEpisodePlan(args: {
  published: EpisodeResult[];
  episode: number;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null | undefined;
}): EpisodePlan | null {
  const { published, episode, contestants, scoringEvents, scoringConfig } = args;
  const result = published.find((r) => r.episode === episode);
  if (!result) return null;

  const match = makeMatcher(contestants);
  const unmatched = new Set<string>();
  const resolve = (names: string[]) =>
    names
      .map((n) => {
        const c = match(n);
        if (!c) unmatched.add(n);
        return c;
      })
      .filter((c): c is Contestant => !!c);

  // Who had left before this episode (per the published results)
  const leftBefore = new Set<string>();
  for (const r of published) {
    if (r.episode < episode) resolve([...r.voted_out, ...r.quit]).forEach((c) => leftBefore.add(c.id));
  }
  // resolve() above may have flagged names from earlier episodes; only report this episode's
  unmatched.clear();

  const votedOut = resolve(result.voted_out);
  const quit = resolve(result.quit);
  const immunity = resolve(result.immunity);
  const finalTribal = resolve(result.final_tribal);
  const winner = result.winner ? resolve([result.winner])[0] : undefined;

  const leftThisEpisode = new Set([...votedOut, ...quit].map((c) => c.id));

  const has = (c: Contestant, key: ActionKey, ep?: number) =>
    scoringEvents.some(
      (e) =>
        e.contestantId === c.id &&
        (ep === undefined || e.episode === ep) &&
        normalizeAction(e.action) === normalizeAction(labelOf(key))
    );

  const events: PlannedEvent[] = [];
  const eliminate = new Set<string>();
  let alreadyEntered = 0;
  const add = (c: Contestant, key: ActionKey) =>
    events.push({
      contestantId: c.id,
      contestantName: c.name,
      owner: c.owner ?? null,
      key,
      action: labelOf(key),
      points: getPoints(key, scoringConfig),
    });

  // Exits: always recorded (even if the league gives 0 points), because they mark who's out
  for (const [list, key] of [
    [votedOut, "VOTED_OUT"],
    [quit, "QUIT"],
  ] as const) {
    for (const c of list) {
      if (has(c, key)) {
        alreadyEntered++;
      } else if (!c.isEliminated) {
        add(c, key);
      } else {
        alreadyEntered++;
      }
      if (!c.isEliminated) eliminate.add(c.id);
    }
  }

  const owned = contestants.filter((c) => !!c.owner);
  const stillInAfter = (c: Contestant) => !c.isEliminated && !leftBefore.has(c.id) && !leftThisEpisode.has(c.id);

  // Survived the episode
  const surviveKey: ActionKey = result.post_merge ? "SURVIVE_POST" : "SURVIVE_PRE";
  if (isActionEnabled(surviveKey, scoringConfig)) {
    for (const c of owned) {
      if (!stillInAfter(c)) continue;
      if (has(c, "SURVIVE_PRE", episode) || has(c, "SURVIVE_POST", episode)) alreadyEntered++;
      else add(c, surviveKey);
    }
  }

  // Individual immunity
  if (isActionEnabled("WIN_IMMUNITY", scoringConfig)) {
    for (const c of immunity) {
      if (!c.owner) continue;
      if (has(c, "WIN_IMMUNITY", episode)) alreadyEntered++;
      else add(c, "WIN_IMMUNITY");
    }
  }

  // Jury starts: everyone still in after this episode makes the jury
  if (result.jury_starts && isActionEnabled("MAKE_JURY", scoringConfig)) {
    for (const c of owned) {
      if (!stillInAfter(c)) continue;
      if (has(c, "MAKE_JURY")) alreadyEntered++;
      else add(c, "MAKE_JURY");
    }
  }

  // Finale
  if (isActionEnabled("MAKE_FINAL", scoringConfig)) {
    for (const c of finalTribal) {
      if (!c.owner) continue;
      if (has(c, "MAKE_FINAL")) alreadyEntered++;
      else add(c, "MAKE_FINAL");
    }
  }
  // The winner event also marks the season as finished, so it's added even at 0 points
  if (winner) {
    if (has(winner, "WIN_SURVIVOR")) alreadyEntered++;
    else add(winner, "WIN_SURVIVOR");
  }

  return {
    episode,
    events,
    eliminate: [...eliminate],
    unmatched: [...unmatched],
    alreadyEntered,
    postMerge: result.post_merge,
  };
}

/** Points added per team, for the review dialog. */
export function pointsByTeam(plan: EpisodePlan) {
  const totals = new Map<string, number>();
  for (const e of plan.events) {
    if (!e.owner) continue;
    totals.set(e.owner, (totals.get(e.owner) || 0) + e.points);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}
