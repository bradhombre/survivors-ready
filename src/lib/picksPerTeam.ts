export function getPicksPerTeam(
  explicit: number | null | undefined,
  gameType: string,
  contestantCount: number,
  teamCount: number
): number {
  if (gameType === "winner_takes_all") return explicit || 1;
  if (explicit) return explicit;
  if (teamCount === 0) return 1;
  return Math.max(1, Math.floor(contestantCount / teamCount));
}

/**
 * How many castaways the draft is sized on: everyone except castaways who went home before the
 * league drafted (a league starting mid-season marks them out first). Drafted castaways always
 * count, so a finished draft keeps its size as the season goes on.
 */
export function draftPoolSize(contestants: { owner?: unknown; isEliminated: boolean }[]): number {
  return contestants.filter((c) => !!c.owner || !c.isEliminated).length;
}
