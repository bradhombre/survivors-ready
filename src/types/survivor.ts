// Player is now dynamic per league - it's a string representing the team name
export type Player = string;

export type GameType = "full" | "winner_takes_all";

export interface Contestant {
  id: string;
  name: string;
  tribe?: string;
  age?: number;
  location?: string;
  owner?: Player;
  pickNumber?: number;
  isEliminated: boolean;
  imageUrl?: string;
}

export type DraftType = "snake" | "linear";

export interface ScoringEvent {
  id: string;
  contestantId: string;
  contestantName: string;
  action: string;
  points: number;
  episode: number;
  timestamp: number;
}

export interface ArchivedSeason {
  season: number;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  finalStandings: { player: Player; score: number; activeCount: number }[];
  archivedAt: number;
}

export interface GameState {
  mode: "setup" | "draft" | "game" | "history" | "admin";
  season: number;
  episode: number;
  isPostMerge: boolean;
  contestants: Contestant[];
  draftOrder: Player[];
  draftType: DraftType;
  currentDraftIndex: number;
  scoringEvents: ScoringEvent[];
  cryingThisEpisode: Set<string>;
  playerProfiles: Record<Player, { avatar?: string }>;
  archivedSeasons: ArchivedSeason[];
  gameType: GameType;
  picksPerTeam?: number | null;
}

// Default players are no longer hardcoded - they come from league_teams table
// This is kept for backward compatibility but should not be used for new code
export const PLAYERS: Player[] = [];

export const SCORING_ACTIONS = {
  FIND_IDOL: { label: "Find Idol 🗿", points: 20, emoji: "🗿", description: "Awarded when a contestant finds a hidden immunity idol at camp or during a challenge." },
  ACQUIRE_IDOL: { label: "Acquire Idol (not found) 💎", points: 10, emoji: "💎", description: "Awarded when a contestant receives an idol from another player (gift, trade, or inheritance) rather than finding it themselves." },
  FIND_ADVANTAGE: { label: "Find Advantage ⚡", points: 10, emoji: "⚡", description: "Awarded when a contestant finds a game advantage (extra vote, steal-a-vote, shot in the dark, etc.)." },
  ACQUIRE_ADVANTAGE: { label: "Acquire Advantage (not found) 🎯", points: 5, emoji: "🎯", description: "Awarded when a contestant receives an advantage from another player rather than finding it themselves." },
  VOTED_OUT_WITH_IDOL: { label: "Voted Out with Idol/Advantage 💔", points: -10, emoji: "💔", description: "Penalty when a contestant is voted out while holding an unplayed idol or advantage." },
  WIN_IMMUNITY: { label: "Win Individual Immunity 🏆", points: 15, emoji: "🏆", description: "Awarded when a contestant wins an individual immunity challenge." },
  QUIT: { label: "Quit 🏳️", points: -50, emoji: "🏳️", description: "Major penalty when a contestant voluntarily leaves the game." },
  CATCH_TOSS: { label: "Catch Jeff Toss 🎪", points: 10, emoji: "🎪", description: "Awarded when a contestant successfully catches an item tossed by Jeff Probst." },
  DROP_TOSS: { label: "Drop Jeff Toss 🤦", points: -10, emoji: "🤦", description: "Penalty when a contestant drops an item tossed by Jeff Probst." },
  CRY: { label: "Cry (limit 1/week) 😭", points: 5, emoji: "😭", description: "Awarded once per episode when a contestant cries on camera (limit 1 per week)." },
  EPISODE_TITLE: { label: "Episode Title 📺", points: 5, emoji: "📺", description: "Awarded when a contestant says the episode title during the episode." },
  TRIBAL_VOTE_CORRECT: { label: "Tribal Vote Correct ✅", points: 5, emoji: "✅", description: "Awarded when a contestant votes for the person who gets eliminated at tribal council." },
  SURVIVE_PRE: { label: "Survive Round (Pre-Merge) 🌴", points: 5, emoji: "🌴", description: "Awarded each episode a contestant survives before the merge." },
  SURVIVE_POST: { label: "Survive Round (Post-Merge) 🔥", points: 10, emoji: "🔥", description: "Awarded each episode a contestant survives after the merge. The finale counts twice for the finalists." },
  MAKE_JURY: { label: "Make Jury ⚖️", points: 50, emoji: "⚖️", description: "One-time bonus when a contestant becomes a member of the jury." },
  MAKE_FINAL: { label: "Make Final Tribal 🎭", points: 75, emoji: "🎭", description: "One-time bonus when a contestant makes it to Final Tribal Council." },
  WIN_SURVIVOR: { label: "Win Survivor 👑", points: 100, emoji: "👑", description: "Ultimate bonus when a contestant wins the season." },
  VOTED_OUT: { label: "Voted Out 💀", points: 0, emoji: "💀", description: "Applied when a contestant is voted out (typically 0 points, marks elimination)." },
  MISC_25: { label: "Misc +25pt Bonus ⭐", points: 25, emoji: "⭐", description: "Flexible bonus for notable moments not covered by other categories." },
  MISC_50: { label: "Misc +50pt Bonus 🌟", points: 50, emoji: "🌟", description: "Larger flexible bonus for exceptional moments." },
  MISC_NEG_10: { label: "Misc -10pt Penalty ⚠️", points: -10, emoji: "⚠️", description: "Flexible penalty for minor negative moments." },
  MISC_NEG_25: { label: "Misc -25pt Penalty 🚫", points: -25, emoji: "🚫", description: "Larger flexible penalty for significant negative moments." },
};

export const SEASON_48_CONTESTANTS = [
  { name: "Stephanie Berger", tribe: "Vula" },
  { name: "Shauhin Davari", tribe: "Lagi" },
  { name: "Eva Erickson", tribe: "" },
  { name: "Kyle Fraser", tribe: "Civa" },
  { name: "Mitch Guerra", tribe: "" },
  { name: "Saiounia 'Sai' Hughley", tribe: "Vula" },
  { name: "Joe Hunter", tribe: "Lagi" },
  { name: "Kamilla Karthigesu", tribe: "Civa" },
  { name: "David Kinne", tribe: "" },
  { name: "Thomas Krottinger", tribe: "Lagi" },
  { name: "Mary Zheng", tribe: "" },
  { name: "Charity Nelms", tribe: "" },
  { name: "Chrissy Hofbeck", tribe: "" },
  { name: "Star Toomey", tribe: "" },
  { name: "Justin Klein", tribe: "" },
  { name: "Kevin Troy", tribe: "" },
  { name: "Jon Lovett", tribe: "" },
  { name: "Andy Rueda", tribe: "" },
];

export const SEASON_48_DRAFT = {
  Roy: ["David Kinne", "Stephanie Berger", "Chrissy Hofbeck", "Star Toomey"],
  Coco: ["Kyle Fraser", "Mary Zheng", "Eva Erickson", "Saiounia 'Sai' Hughley"],
  Brad: ["Shauhin Davari", "Thomas Krottinger", "Kamilla Karthigesu", "Justin Klein"],
  Kalin: ["Charity Nelms", "Mitch Guerra", "Joe Hunter", "Kevin Troy"],
};
