// Pure logic for the automatic episode results job (no Deno or network APIs here, so it can be
// tested with Node). index.ts does the fetching, AI extraction and database writes.

export type SourceName = "survivor_wiki" | "wikipedia";

/** What the AI returns per episode, before validation. */
export type RawEpisode = {
  episode: number;
  air_date?: string | null;
  voted_out?: string[];
  quit?: string[];
  medevac?: string[];
  individual_immunity?: string[];
  merged?: boolean;
  first_juror_voted_out?: boolean;
  final_tribal?: string[];
  winner?: string | null;
  uncertain?: string[];
};

/** Validated facts for one episode, using official cast names. */
export type EpisodeFacts = {
  episode: number;
  air_date: string | null;
  voted_out: string[];
  quit: string[];
  left_game: string[];
  immunity: string[];
  post_merge: boolean;
  jury_starts: boolean;
  final_tribal: string[];
  winner: string | null;
};

export type SourceFacts = {
  source: SourceName;
  episodes: Map<number, EpisodeFacts>;
  /** Episodes this source listed but that failed validation, with the reason */
  problems: Map<number, string>;
  /** Episodes listed with nobody leaving (usually a row not filled in yet), with the air date */
  empty: Map<number, string | null>;
};

export const CONFIG = {
  /** Both sources must agree and be unchanged this long */
  agreeStableHours: 2,
  /** Wikipedia often lags by days. If it has nothing yet (it doesn't disagree), the Survivor Wiki alone must be unchanged this long */
  wikiAloneStableHours: 6,
  /** Never publish before this many hours after 00:00 UTC on the air date. 32 = 08:00 UTC the next
   *  day: midnight Pacific in winter, after even a 3-hour finale ends on the West Coast. */
  hoursAfterAirDay: 32,
  /** An episode the wikis show with nobody leaving goes to you for review after this many more hours */
  emptyReviewHours: 48,
};

export const normalizeName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Turn wiki page HTML into compact "## caption / row | row" text: tables only, long cells trimmed. */
export function htmlTablesToText(html: string, maxCell = 160): string {
  const decode = (s: string) =>
    s
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&#039;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#8211;|&ndash;/g, "-")
      .replace(/&#8212;|&mdash;/g, "-")
      .replace(/&#\d+;/g, " ");
  const h = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<sup[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
  const out: string[] = [];
  const re = /<table[\s\S]*?<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(h))) {
    const t = m[0];
    const cap = (t.match(/<caption[^>]*>([\s\S]*?)<\/caption>/i) || [])[1];
    const rows = t
      .split(/<tr[^>]*>/i)
      .slice(1)
      .map((r) =>
        r
          .split(/<t[dh][^>]*>/i)
          .slice(1)
          .map((c) => {
            const text = decode(c.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
            return text.length > maxCell ? text.slice(0, maxCell) + "…" : text;
          })
          .join(" | ")
      )
      .filter((r) => r.replace(/[|\s]/g, "").length > 0);
    if (rows.length > 1) {
      const title = cap ? decode(cap.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() : "table";
      out.push(`## ${title}\n${rows.join("\n")}`);
    }
  }
  return out.join("\n\n");
}

/** Cheap stable hash for change detection (not security). */
export function hashText(s: string): string {
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
 * Check the AI's answer against the official cast and basic Survivor logic. An episode with any
 * name we can't place, anything the AI marked uncertain, or impossible data is left out (and the
 * reason recorded), so it can never be auto-published.
 */
export function validateSource(source: SourceName, raw: RawEpisode[], castNames: string[]): SourceFacts {
  const byNorm = new Map(castNames.map((n) => [normalizeName(n), n]));
  const episodes = new Map<number, EpisodeFacts>();
  const problems = new Map<number, string>();
  const empty = new Map<number, string | null>();
  // The AI's answer is untrusted: anything that isn't a list of names is treated as a list
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v.trim() ? [v] : [];
  const sorted = [...(Array.isArray(raw) ? raw : [])]
    .filter((r) => r && typeof r === "object" && Number.isInteger(r.episode) && r.episode >= 1)
    .sort((a, b) => a.episode - b.episode);
  const gone = new Set<string>();
  // Nothing counts after the finale (the Survivor Wiki lists the reunion/aftershow as the next episode)
  const finale = sorted.find((r) => typeof r.winner === "string" && r.winner.trim());
  const uncertainOf = (r: RawEpisode) => list(r.uncertain);

  for (const r of sorted) {
    if (finale && r.episode > finale.episode) break;
    const bad: string[] = [];
    const fix = (names: unknown) =>
      list(names)
        .filter((n) => n.trim())
        .map((n) => {
          const official = byNorm.get(normalizeName(n));
          if (!official) bad.push(`"${n}" isn't in the official cast`);
          return official || n;
        });
    const f: EpisodeFacts = {
      episode: r.episode,
      air_date: typeof r.air_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.air_date) ? r.air_date : null,
      voted_out: fix(r.voted_out),
      quit: fix(r.quit),
      left_game: fix(r.medevac),
      immunity: fix(r.individual_immunity),
      post_merge: !!r.merged,
      jury_starts: !!r.first_juror_voted_out,
      final_tribal: fix(r.final_tribal),
      winner: typeof r.winner === "string" && r.winner.trim() ? fix([r.winner])[0] : null,
    };
    const unsure = uncertainOf(r);
    if (unsure.length) bad.push(`marked uncertain: ${unsure.join("; ")}`);
    const exits = [...f.voted_out, ...f.quit, ...f.left_game];
    // Nobody left and it isn't the finale: almost always a row that isn't filled in yet. Never
    // published automatically (decide() sends it to you if it stays that way).
    if (!bad.length && exits.length === 0 && !f.final_tribal.length && !f.winner) {
      empty.set(r.episode, f.air_date);
      continue;
    }
    if (new Set(exits).size !== exits.length) bad.push("someone is listed as leaving twice");
    for (const n of exits) if (gone.has(n)) bad.push(`${n} already left in an earlier episode`);
    for (const n of [...f.immunity, ...f.final_tribal, ...(f.winner ? [f.winner] : [])])
      if (gone.has(n)) bad.push(`${n} already left, so can't win immunity or reach the end`);
    // With one Tribal Council, the immunity winner can't go home. Finales and double episodes have
    // several, so someone can win the first immunity and be voted out at the next one.
    if (exits.length <= 1)
      for (const n of f.immunity) if (f.voted_out.includes(n)) bad.push(`${n} can't win immunity and be voted out`);
    if (exits.length > 4) bad.push("more than 4 people left in one episode");
    if (!f.air_date) bad.push("no air date");

    if (bad.length) problems.set(r.episode, bad.join("; "));
    else episodes.set(r.episode, f);
    exits.forEach((n) => gone.add(n));
  }
  return { source, episodes, problems, empty };
}

const sortedList = (a: string[]) => [...a].sort().join("|");

/** Do two sources say the same thing about an episode (the fields that affect scoring)? */
export function factsKey(f: EpisodeFacts): string {
  return JSON.stringify([
    sortedList(f.voted_out),
    sortedList(f.quit),
    sortedList(f.left_game),
    sortedList(f.immunity),
    f.post_merge,
    f.jury_starts,
    sortedList(f.final_tribal),
    f.winner || "",
  ]);
}

export type Candidate = { hash: string; first_seen_at: string };

export type Decision =
  | { episode: number; action: "publish"; facts: EpisodeFacts; note: string }
  | { episode: number; action: "wait"; reason: string }
  | { episode: number; action: "review"; reason: string };

/**
 * Decide what to do with the next unpublished episode(s), strictly in order.
 * `published` = episodes already live; `manual` = episodes with a row the site owner is editing.
 */
export function decide(args: {
  wiki: SourceFacts;
  wikipedia: SourceFacts | null;
  candidates: Map<string, Candidate>; // key `${source}:${episode}`
  published: Set<number>;
  manual: Set<number>;
  lastPublishedPostMerge: boolean;
  now: Date;
  config?: typeof CONFIG;
}): Decision[] {
  const { wiki, wikipedia, candidates, published, manual, now } = args;
  const cfg = args.config || CONFIG;
  const out: Decision[] = [];
  let merged = args.lastPublishedPostMerge;
  const maxPublished = Math.max(0, ...published);

  const hoursSince = (iso?: string) => (iso ? (now.getTime() - Date.parse(iso)) / 3.6e6 : -1);

  for (let ep = maxPublished + 1; ep <= maxPublished + 3; ep++) {
    if (manual.has(ep)) {
      out.push({ episode: ep, action: "wait", reason: "You have a draft for this episode in Site admin; it won't be touched." });
      break;
    }
    const w = wiki.episodes.get(ep);
    const wp = wikipedia?.episodes.get(ep) || null;
    if (!w) {
      const why = wiki.problems.get(ep);
      const air = wiki.empty.get(ep);
      if (why) out.push({ episode: ep, action: "review", reason: `Survivor Wiki: ${why}` });
      else if (air && now.getTime() >= Date.parse(`${air}T00:00:00Z`) + (cfg.hoursAfterAirDay + cfg.emptyReviewHours) * 3.6e6)
        out.push({
          episode: ep,
          action: "review",
          reason: "The Survivor Wiki still shows nobody leaving this episode, 2 days after it aired. If that's right, publish it by hand in Site admin.",
        });
      break; // not there yet, or not usable
    }
    const airOk = w.air_date && now.getTime() >= Date.parse(`${w.air_date}T00:00:00Z`) + cfg.hoursAfterAirDay * 3.6e6;
    if (!airOk) {
      out.push({ episode: ep, action: "wait", reason: "Waiting until the episode has aired on the West Coast." });
      break;
    }
    const wikiAge = hoursSince(candidates.get(`survivor_wiki:${ep}`)?.first_seen_at);
    const facts = { ...w, post_merge: w.post_merge || merged };

    if (wp) {
      if (factsKey(wp) !== factsKey(w)) {
        out.push({ episode: ep, action: "review", reason: "Survivor Wiki and Wikipedia disagree." });
        break;
      }
      const wpAge = hoursSince(candidates.get(`wikipedia:${ep}`)?.first_seen_at);
      if (Math.min(wikiAge, wpAge) >= cfg.agreeStableHours) {
        out.push({ episode: ep, action: "publish", facts, note: "Survivor Wiki and Wikipedia agree." });
        merged = facts.post_merge;
        if (facts.winner) break; // the finale is the last episode
        continue;
      }
      out.push({ episode: ep, action: "wait", reason: `Both wikis agree; waiting until they've been steady for ${cfg.agreeStableHours} hours.` });
      break;
    }
    if (wikipedia?.problems.get(ep)) {
      out.push({ episode: ep, action: "review", reason: `Wikipedia: ${wikipedia.problems.get(ep)}` });
      break;
    }
    if (wikiAge >= cfg.wikiAloneStableHours) {
      out.push({ episode: ep, action: "publish", facts, note: `Survivor Wiki, steady for ${cfg.wikiAloneStableHours}+ hours; Wikipedia not updated yet.` });
      merged = facts.post_merge;
      if (facts.winner) break;
      continue;
    }
    out.push({ episode: ep, action: "wait", reason: `Survivor Wiki has it; waiting until it's been steady for ${cfg.wikiAloneStableHours} hours (Wikipedia isn't updated yet).` });
    break;
  }
  return out;
}
