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
  /** Medevac or removed: out of the game, but no Quit penalty */
  left_game: string[];
  immunity: string[];
  post_merge: boolean;
  jury_starts: boolean;
  final_tribal: string[];
  winner: string | null;
  status?: "draft" | "published";
  published_at?: string | null;
  updated_at?: string;
  /** "auto" when the wiki job published it */
  source?: "manual" | "auto";
  auto_note?: string | null;
};

/** Not a configurable scoring action: 0 points, only records that a castaway left. */
export const MEDEVAC_LABEL = "Medevac / Removed 🚑";

export type ActionKey = keyof typeof SCORING_ACTIONS | "MEDEVAC";

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
  /** Exit names (voted out / quit / left) this league's cast doesn't have. Must be resolved before applying. */
  unmatchedExits: string[];
  /** Other names (immunity, finale) not in this league's cast; shown as a note */
  unmatchedOther: string[];
  /** Events that were already entered by hand and are skipped */
  alreadyEntered: number;
  /** Scores this league already has for this episode number (entered by hand) */
  existingForEpisode: number;
  postMerge: boolean;
};

/** Lowercase, no accents, letters and digits only ("Thien-An Nguyen" -> "thienannguyen"). */
export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Matches a scoring event's saved text to an action, ignoring emoji and spacing. */
const normalizeAction = normalizeName;

const labelOf = (key: ActionKey) => (key === "MEDEVAC" ? MEDEVAC_LABEL : SCORING_ACTIONS[key].label);

/**
 * Exact name matching only (ignoring case, accents, spaces and punctuation). A near-match could
 * score the wrong castaway, so anything else is left for the commissioner to pick.
 * `overrides` maps a results name to a contestant id, or to "" for "not in my league".
 */
export function makeMatcher(contestants: Contestant[], overrides: Record<string, string> = {}) {
  const byFull = new Map<string, Contestant>();
  for (const c of contestants) byFull.set(normalizeName(c.name), c);
  const byId = new Map(contestants.map((c) => [c.id, c]));
  return (name: string): Contestant | null | undefined => {
    if (name in overrides) return overrides[name] ? byId.get(overrides[name]) ?? undefined : null; // null = not in league
    return byFull.get(normalizeName(name));
  };
}

/**
 * Everything a league needs added for one episode.
 * `published` is every published result for the season; earlier episodes decide who was
 * already out, so a league that fell behind never gets survival points for someone who left.
 */
export function buildEpisodePlan(args: {
  published: EpisodeResult[];
  episode: number;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null | undefined;
  overrides?: Record<string, string>;
  /** Episodes this league took no points for (it started after they aired) */
  skipped?: Set<number>;
}): EpisodePlan | null {
  const { published, episode, contestants, scoringEvents, scoringConfig, overrides = {}, skipped = new Set<number>() } = args;
  const result = published.find((r) => r.episode === episode);
  if (!result) return null;

  const match = makeMatcher(contestants, overrides);
  const resolve = (names: string[], unmatched?: Set<string>) =>
    names
      .map((n) => {
        const c = match(n);
        if (c === undefined) unmatched?.add(n);
        return c || undefined;
      })
      .filter((c): c is Contestant => !!c);

  // Who had left before this episode (per the published results)
  const leftBefore = new Set<string>();
  for (const r of published) {
    if (r.episode < episode) resolve([...r.voted_out, ...r.quit, ...(r.left_game || [])]).forEach((c) => leftBefore.add(c.id));
  }

  const unmatchedExits = new Set<string>();
  const unmatchedOther = new Set<string>();
  const votedOut = resolve(result.voted_out, unmatchedExits);
  const quit = resolve(result.quit, unmatchedExits);
  const leftGame = resolve(result.left_game || [], unmatchedExits);
  const immunity = resolve(result.immunity, unmatchedOther);
  const finalTribal = resolve(result.final_tribal, unmatchedOther);
  const winner = result.winner ? resolve([result.winner], unmatchedOther)[0] : undefined;

  const leftThisEpisode = new Set([...votedOut, ...quit, ...leftGame].map((c) => c.id));

  // A league that started late often hand-scores its first real episode under the app's default
  // "Episode 1". Events numbered as a skipped episode count toward the next episode it played.
  const eff = (n: number) => {
    let x = n;
    while (skipped.has(x)) x++;
    return x;
  };
  const skippedBefore = [...skipped].filter((n) => n < episode).length;
  const eventsFor = (c: Contestant) =>
    scoringEvents.filter((e) => e.contestantId === c.id).map((e) => ({ ...e, episode: eff(e.episode) }));
  const isAction = (e: ScoringEvent, key: ActionKey) => normalizeAction(e.action) === normalizeAction(labelOf(key));
  const has = (c: Contestant, key: ActionKey, ep?: number) =>
    eventsFor(c).some((e) => (ep === undefined || e.episode === ep) && isAction(e, key));
  const isSurvive = (e: ScoringEvent) => isAction(e, "SURVIVE_PRE") || isAction(e, "SURVIVE_POST");

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
      points: key === "MEDEVAC" ? 0 : getPoints(key, scoringConfig),
    });

  // Exits: always recorded (even at 0 points), because they mark who's out
  for (const [list, key] of [
    [votedOut, "VOTED_OUT"],
    [quit, "QUIT"],
    [leftGame, "MEDEVAC"],
  ] as const) {
    for (const c of list) {
      if (c.isEliminated || has(c, key)) alreadyEntered++;
      else add(c, key);
      if (!c.isEliminated) eliminate.add(c.id);
    }
  }

  const owned = contestants.filter((c) => !!c.owner);
  const stillInAfter = (c: Contestant) => !c.isEliminated && !leftBefore.has(c.id) && !leftThisEpisode.has(c.id);

  // Survived the episode. The finale is really two episodes, so the finalists (final two or
  // three) get two survival rounds for it. Rounds are skipped when already entered by hand for
  // this episode, when the league has survival for a later episode (its numbering runs ahead), or
  // when the castaway already has survival points for this many episodes (numbering runs behind).
  const isFinale = result.final_tribal.length > 0 || !!result.winner;
  const rounds = isFinale ? 2 : 1;
  const finalistIds = new Set(finalTribal.map((c) => c.id));
  const surviveKey = result.post_merge ? "SURVIVE_POST" : "SURVIVE_PRE";
  if (isActionEnabled(surviveKey, scoringConfig)) {
    for (const c of owned) {
      if (!stillInAfter(c)) continue;
      if (isFinale && finalistIds.size > 0 && !finalistIds.has(c.id)) continue;
      const surv = eventsFor(c).filter(isSurvive);
      const thisEpisode = surv.filter((e) => e.episode === episode).length;
      const ahead = surv.some((e) => e.episode > episode);
      const target = episode - skippedBefore + (rounds - 1); // survival rounds owed through this episode
      const needed = ahead ? 0 : Math.max(0, Math.min(rounds - thisEpisode, target - surv.length));
      alreadyEntered += rounds - needed;
      for (let i = 0; i < needed; i++) add(c, surviveKey);
    }
  }

  // Individual immunity: once per challenge won (a finale can have two for the same castaway).
  // Wins already entered by hand for this episode are subtracted.
  if (isActionEnabled("WIN_IMMUNITY", scoringConfig)) {
    const entered = new Map<string, number>();
    for (const c of immunity) {
      if (!c.owner) continue;
      if (!entered.has(c.id))
        entered.set(c.id, eventsFor(c).filter((e) => e.episode === episode && isAction(e, "WIN_IMMUNITY")).length);
      const left = entered.get(c.id)!;
      if (left > 0) {
        entered.set(c.id, left - 1);
        alreadyEntered++;
      } else add(c, "WIN_IMMUNITY");
    }
  }

  // Jury starts this episode: everyone still in afterward, plus the first juror voted out now
  if (result.jury_starts && isActionEnabled("MAKE_JURY", scoringConfig)) {
    const jurors = [...owned.filter(stillInAfter), ...votedOut.filter((c) => !!c.owner)];
    for (const c of jurors) {
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
  // The winner event also finishes the season, so it's added even at 0 points
  if (winner) {
    if (has(winner, "WIN_SURVIVOR")) alreadyEntered++;
    else add(winner, "WIN_SURVIVOR");
  }

  return {
    episode,
    events,
    eliminate: [...eliminate],
    unmatchedExits: [...unmatchedExits],
    unmatchedOther: [...unmatchedOther],
    alreadyEntered,
    existingForEpisode: scoringEvents.filter((e) => eff(e.episode) === episode).length,
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

/**
 * Which published episode a league should see next: the lowest one it hasn't handled, but only
 * if no earlier episode is missing (so a fix-in-progress never scores out of order).
 */
export function nextPendingEpisode(published: EpisodeResult[], handled: Set<number>) {
  const eps = [...new Set(published.map((r) => r.episode))].sort((a, b) => a - b);
  if (eps.length === 0) return { next: undefined as number | undefined, blocked: false, waiting: 0 };
  const pending = eps.filter((e) => !handled.has(e));
  if (pending.length === 0) return { next: undefined, blocked: false, waiting: 0 };
  const first = pending[0];
  // A gap between the lowest published episode and `first` means results are being fixed
  const lowest = eps[0];
  for (let e = lowest; e < first; e++) {
    if (!eps.includes(e)) return { next: undefined, blocked: true, waiting: pending.length };
  }
  return { next: first, blocked: false, waiting: pending.length };
}
