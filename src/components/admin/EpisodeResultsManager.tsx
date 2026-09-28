import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Clapperboard, AlertTriangle, RefreshCw, Bot } from "lucide-react";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useAuth } from "@/hooks/useAuth";
import { useAdminEpisodeResults } from "@/hooks/useEpisodeResults";
import type { EpisodeResult } from "@/lib/episodeResults";

type CastRow = { name: string; tribe: string | null };

const empty = (season: number, episode: number, postMerge = false): EpisodeResult => ({
  season,
  episode,
  voted_out: [],
  quit: [],
  left_game: [],
  immunity: [],
  post_merge: postMerge,
  jury_starts: false,
  final_tribal: [],
  winner: null,
  status: "draft",
});

const comparable = (r: EpisodeResult) =>
  JSON.stringify([
    [...r.voted_out].sort(),
    [...r.quit].sort(),
    [...(r.left_game || [])].sort(),
    [...r.immunity].sort(),
    r.post_merge,
    r.jury_starts,
    [...r.final_tribal].sort(),
    r.winner || null,
  ]);

/** A row of castaway pills; tapping toggles a name in `value`. */
function CastPicker({
  id,
  label,
  hint,
  cast,
  value,
  onChange,
  outBefore,
}: {
  id: string;
  label: string;
  hint?: string;
  cast: CastRow[];
  value: string[];
  onChange: (next: string[]) => void;
  outBefore: Map<string, number>;
}) {
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((n) => n !== name) : [...value, name]);
  return (
    <fieldset className="space-y-2" aria-labelledby={`${id}-label`}>
      <div>
        <p id={`${id}-label`} className="label-caps text-muted-foreground">
          {label}
          {value.length > 0 && <span className="tabular"> · {value.length}</span>}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {cast.map((c) => {
          const on = value.includes(c.name);
          const outEp = outBefore.get(c.name);
          return (
            <button
              key={c.name}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c.name)}
              className={`min-h-[40px] rounded-full px-3 text-sm font-bold transition-colors ${
                on
                  ? "bg-primary text-primary-foreground border-2 border-plank"
                  : outEp
                  ? "glass text-muted-foreground line-through"
                  : "glass text-foreground hover:bg-muted"
              }`}
              title={outEp ? `Out in episode ${outEp}` : undefined}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

type SyncRun = { id: number; ran_at: string; ok: boolean; summary: string | null };

/** The hourly wiki job: recent runs and a "check now" button. */
function AutoResultsPanel({ onChecked }: { onChecked: () => void }) {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [checking, setChecking] = useState(false);
  const load = async () => {
    const { data } = await (supabase as unknown as { from: (t: string) => any })
      .from("episode_sync_log")
      .select("id, ran_at, ok, summary")
      .order("ran_at", { ascending: false })
      .limit(5);
    setRuns((data as SyncRun[]) || []);
  };
  useEffect(() => {
    load();
  }, []);
  const checkNow = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-episode-results", { body: { force: true } });
      if (error) throw error;
      toast.success((data as { summary?: string })?.summary || "Checked the wikis");
      await load();
      onChecked();
    } catch (err: any) {
      toast.error(`Couldn't check the wikis: ${err?.message || "try again"}`);
    } finally {
      setChecking(false);
    }
  };
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-muted-foreground" />
          Automatic results
        </CardTitle>
        <CardDescription>
          Every hour the site reads the Survivor Wiki and Wikipedia. It publishes an episode on its own when both
          agree for 2 hours, or when the Survivor Wiki has been steady for 6 hours and Wikipedia hasn't caught up yet.
          It never publishes before the West Coast airing ends. If the wikis disagree, it waits and emails you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button variant="outline" className="h-11 gap-2" onClick={checkNow} disabled={checking}>
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking…" : "Check the wikis now"}
        </Button>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checks yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.map((r) => (
              <li key={r.id} className="py-2 text-sm flex gap-3">
                <span className="shrink-0 w-24 text-muted-foreground tabular">{fmt(r.ran_at)}</span>
                <span className={r.ok ? "" : "text-destructive font-semibold"}>{r.summary || (r.ok ? "Checked" : "Failed")}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Site admin > Episodes. The site owner enters each episode's big facts once; commissioners
 * then get an "Episode N results are in" card with one Apply tap.
 */
export function EpisodeResultsManager() {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const currentSeason = parseInt((settings.current_season || "").match(/\d{1,4}/)?.[0] || "", 10) || undefined;
  const [season, setSeason] = useState<number | undefined>(undefined);
  const [seasonText, setSeasonText] = useState("");
  useEffect(() => {
    if (!season && currentSeason) {
      setSeason(currentSeason);
      setSeasonText(String(currentSeason));
    }
  }, [currentSeason, season]);

  const { results: rawResults, resultsSeason, loading, error, save, refresh } = useAdminEpisodeResults(season);
  // Never use results that belong to a different season than the one on screen
  const results = useMemo(() => (resultsSeason === season ? rawResults : []), [resultsSeason, season, rawResults]);
  const [cast, setCast] = useState<CastRow[]>([]);
  const [episode, setEpisode] = useState<number>(1);
  const [form, setForm] = useState<EpisodeResult | null>(null);
  const [showFinale, setShowFinale] = useState(false);
  const [saving, setSaving] = useState(false);

  // Official cast for the season (ignore late answers for a season we've moved away from)
  useEffect(() => {
    if (!season) return;
    let cancelled = false;
    setCast([]);
    supabase
      .from("master_contestants")
      .select("name, tribe")
      .eq("season_number", season)
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setCast((data as CastRow[]) || []);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  // Open on the next episode that has no results yet (once per season, not after every save)
  const openedFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (loading || !season || resultsSeason !== season || openedFor.current === season) return;
    openedFor.current = season;
    const maxEp = results.reduce((m, r) => Math.max(m, r.episode), 0);
    setEpisode(maxEp > 0 ? maxEp + (results.find((r) => r.episode === maxEp)?.status === "published" ? 1 : 0) : 1);
  }, [loading, season, resultsSeason, results]);

  const existing = results.find((r) => r.episode === episode);
  const previous = results.find((r) => r.episode === episode - 1);
  const baseline = useMemo(
    () => (season ? (existing ? { left_game: [], ...existing } : empty(season, episode, previous?.post_merge ?? false)) : null),
    [season, episode, existing, previous?.post_merge]
  );
  useEffect(() => {
    if (!baseline) return;
    setForm(baseline);
    setShowFinale(!!(baseline.final_tribal.length || baseline.winner));
  }, [baseline]);

  // Who had already left before this episode (from saved results)
  const outBefore = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      if (r.episode >= episode) continue;
      for (const n of [...r.voted_out, ...r.quit, ...(r.left_game || [])]) if (!m.has(n)) m.set(n, r.episode);
    }
    return m;
  }, [results, episode]);

  if (!season || !form) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const dirty = !!baseline && comparable(form) !== comparable(baseline);
  const set = (patch: Partial<EpisodeResult>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const goToEpisode = (ep: number) => {
    if (ep === episode) return;
    if (dirty && !window.confirm(`Discard your unsaved changes to episode ${episode}?`)) return;
    setEpisode(ep);
  };
  const commitSeason = () => {
    const n = parseInt(seasonText, 10);
    if (!n || n === season) {
      setSeasonText(String(season));
      return;
    }
    if (dirty && !window.confirm(`Discard your unsaved changes to episode ${episode}?`)) {
      setSeasonText(String(season));
      return;
    }
    setSeason(n);
  };

  const exits = [...form.voted_out, ...form.quit, ...(form.left_game || [])];
  const warnings: string[] = [];
  const both = form.voted_out.filter((n) => form.immunity.includes(n));
  if (both.length) warnings.push(`${both.join(", ")} can't be voted out and win immunity in the same episode.`);
  const twice = exits.filter((n, i) => exits.indexOf(n) !== i);
  if (twice.length) warnings.push(`${[...new Set(twice)].join(", ")} is in more than one "left" list.`);
  const already = exits.filter((n) => outBefore.has(n));
  if (already.length) warnings.push(`${already.join(", ")} already left in an earlier episode.`);
  const deadImmunity = [...form.immunity, ...form.final_tribal, ...(form.winner ? [form.winner] : [])].filter((n) => outBefore.has(n));
  if (deadImmunity.length) warnings.push(`${[...new Set(deadImmunity)].join(", ")} already left, so can't win immunity or reach the end.`);
  if (!exits.length) warnings.push("Nobody left this episode. Is that right?");
  const earlierMerged = results.some((r) => r.episode < episode && r.post_merge);
  if (earlierMerged && !form.post_merge) warnings.push("An earlier episode is post-merge but this one isn't. Check the switch below.");

  // Publishing order: every earlier episode (from the first one entered) must already be live
  const firstEntered = results.reduce((m, r) => Math.min(m, r.episode), Infinity);
  const missingEarlier: number[] = [];
  for (let e = Number.isFinite(firstEntered) ? firstEntered : episode; e < episode; e++) {
    if (results.find((r) => r.episode === e)?.status !== "published") missingEarlier.push(e);
  }
  const laterLive = results.some((r) => r.episode > episode && r.status === "published");
  const blocking = both.length > 0 || twice.length > 0;
  const isPublished = existing?.status === "published";

  const doSave = async (publish: boolean | null) => {
    setSaving(true);
    try {
      await save({ ...form, season, episode }, publish, user?.id);
      toast.success(
        publish === true
          ? `Episode ${episode} is live. Commissioners will see "Episode ${episode} results are in".`
          : publish === false
          ? `Episode ${episode} is back to draft. Commissioners won't see it.`
          : `Episode ${episode} saved as a draft`
      );
    } catch (err: any) {
      toast.error(`Couldn't save: ${err?.message || "try again"}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <AutoResultsPanel onChecked={refresh} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-muted-foreground" />
            Episode results
          </CardTitle>
          <CardDescription>
            Results normally fill in automatically (above). Use this to check them, fix them, or enter an episode by hand.
            When an episode is published, the commissioner of every drafted full-fantasy
            league on Season {season} gets an "Episode results are in" card, and one tap adds voted out, survival,
            immunity, jury and finale points. Cries, Jeff tosses, idols and bonuses stay with commissioners.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-3 text-sm">
              Couldn't load results: {error}. If this says the table doesn't exist, the auto-scoring database change
              hasn't been applied yet.
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="er-season" className="label-caps text-muted-foreground">Season</Label>
              <Input
                id="er-season"
                type="number"
                min={1}
                value={seasonText}
                onChange={(e) => setSeasonText(e.target.value)}
                onBlur={commitSeason}
                onKeyDown={(e) => e.key === "Enter" && commitSeason()}
                className="w-24 font-extrabold tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er-episode" className="label-caps text-muted-foreground">Episode</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="icon" aria-label="Previous episode" onClick={() => goToEpisode(Math.max(1, episode - 1))}>
                  −
                </Button>
                <span className="w-10 text-center text-2xl font-black tabular" aria-live="polite">{episode}</span>
                <Button type="button" variant="outline" size="icon" aria-label="Next episode" onClick={() => goToEpisode(episode + 1)}>
                  +
                </Button>
              </div>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                isPublished
                  ? "bg-success text-success-foreground"
                  : existing
                  ? "bg-warning text-warning-foreground"
                  : "glass text-muted-foreground"
              }`}
            >
              {isPublished ? "Live for commissioners" : existing ? "Draft, not live" : "Not entered yet"}
            </span>
            {dirty && <span className="text-xs font-bold text-accent">Unsaved changes</span>}
          </div>

          {cast.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No official cast found for Season {season}. Import it in the Cast tab first.
            </p>
          ) : (
            <>
              <CastPicker id="er-out" label="Voted out" cast={cast} value={form.voted_out} onChange={(v) => set({ voted_out: v })} outBefore={outBefore} />
              <CastPicker
                id="er-quit"
                label="Quit"
                hint="Chose to leave. Leagues' Quit penalty applies."
                cast={cast}
                value={form.quit}
                onChange={(v) => set({ quit: v })}
                outBefore={outBefore}
              />
              <CastPicker
                id="er-left"
                label="Medevac or removed"
                hint="Out of the game, with no penalty."
                cast={cast}
                value={form.left_game || []}
                onChange={(v) => set({ left_game: v })}
                outBefore={outBefore}
              />
              <CastPicker
                id="er-imm"
                label="Won individual immunity"
                hint="Individual immunity only. Tribe immunity isn't a scoring event."
                cast={cast}
                value={form.immunity}
                onChange={(v) => set({ immunity: v })}
                outBefore={outBefore}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label htmlFor="er-merge" className="glass rounded-[12px] flex items-start gap-3 p-3 cursor-pointer">
                  <Switch id="er-merge" checked={form.post_merge} onCheckedChange={(v) => set({ post_merge: v })} />
                  <span className="text-sm">
                    <b className="block">Post-merge episode</b>
                    <span className="text-muted-foreground">Everyone still in gets post-merge survival points. Carries over from the last episode.</span>
                  </span>
                </label>
                <label htmlFor="er-jury" className="glass rounded-[12px] flex items-start gap-3 p-3 cursor-pointer">
                  <Switch id="er-jury" checked={form.jury_starts} onCheckedChange={(v) => set({ jury_starts: v })} />
                  <span className="text-sm">
                    <b className="block">The first juror is voted out this episode</b>
                    <span className="text-muted-foreground">Everyone still in, plus the castaway voted out now, gets Make Jury (once).</span>
                  </span>
                </label>
              </div>

              {!showFinale ? (
                <Button type="button" variant="ghost" className="h-11" onClick={() => setShowFinale(true)}>
                  This is the finale
                </Button>
              ) : (
                <div className="space-y-4 rounded-[12px] border-2 border-border p-4">
                  <CastPicker id="er-ftc" label="Made Final Tribal" cast={cast} value={form.final_tribal} onChange={(v) => set({ final_tribal: v })} outBefore={outBefore} />
                  <div className="space-y-1.5">
                    <Label htmlFor="er-winner" className="label-caps text-muted-foreground">Sole Survivor</Label>
                    <select
                      id="er-winner"
                      value={form.winner || ""}
                      onChange={(e) => set({ winner: e.target.value || null })}
                      className="flex h-11 w-full max-w-sm rounded-[10px] border-2 border-input bg-card px-3 text-sm font-semibold"
                    >
                      <option value="">Not decided</option>
                      {cast.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">When a league applies the winner, its season is marked finished.</p>
                  </div>
                </div>
              )}

              {warnings.length > 0 && (
                <ul className="space-y-1.5">
                  {warnings.map((w) => (
                    <li key={w} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}

              {missingEarlier.length > 0 && (
                <p className="text-sm font-semibold">
                  Publish episode{missingEarlier.length > 1 ? "s" : ""} {missingEarlier.join(", ")} first, so leagues score in order.
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="accent"
                  className="h-11"
                  onClick={() => doSave(true)}
                  disabled={saving || blocking || missingEarlier.length > 0}
                >
                  {isPublished ? "Save changes (stays live)" : "Publish to commissioners"}
                </Button>
                {!isPublished && (
                  <Button variant="outline" className="h-11" onClick={() => doSave(null)} disabled={saving || blocking}>
                    Save as draft
                  </Button>
                )}
                {isPublished && (
                  <Button
                    variant="ghost"
                    className="h-11"
                    onClick={() => {
                      if (window.confirm(`Unpublish episode ${episode}? Leagues that haven't applied it yet won't see it until you publish again.`)) doSave(false);
                    }}
                    disabled={saving || laterLive}
                    title={laterLive ? "Unpublish later episodes first" : undefined}
                  >
                    Unpublish
                  </Button>
                )}
              </div>
              {isPublished && (
                <p className="text-xs text-muted-foreground">
                  Leagues that already applied this episode keep what they got; they can undo and re-apply from their card.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Season {season} so far</CardTitle>
        </CardHeader>
        <CardContent>
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No episodes entered yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {results.map((r) => (
                <li key={r.episode} className="py-2.5 flex flex-wrap items-center justify-between gap-3 min-h-[44px]">
                  <button type="button" onClick={() => goToEpisode(r.episode)} className="text-left min-w-0 hover:underline">
                    <span className="font-bold tabular">Episode {r.episode}</span>
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      · Out: {[...r.voted_out, ...r.quit, ...(r.left_game || [])].join(", ") || "nobody"}
                      {r.immunity.length ? ` · Immunity: ${r.immunity.join(", ")}` : ""}
                      {r.post_merge ? " · post-merge" : ""}
                      {r.source === "auto" ? ` · automatic${r.auto_note ? ` (${r.auto_note})` : ""}` : ""}
                    </span>
                  </button>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      r.status === "published" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"
                    }`}
                  >
                    {r.status === "published" ? "Live" : "Draft"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
