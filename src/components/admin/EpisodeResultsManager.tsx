import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Clapperboard, AlertTriangle } from "lucide-react";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useAuth } from "@/hooks/useAuth";
import { useAdminEpisodeResults } from "@/hooks/useEpisodeResults";
import type { EpisodeResult } from "@/lib/episodeResults";

type CastRow = { name: string; tribe: string | null };

const empty = (season: number, episode: number): EpisodeResult => ({
  season,
  episode,
  voted_out: [],
  quit: [],
  immunity: [],
  post_merge: false,
  jury_starts: false,
  final_tribal: [],
  winner: null,
  status: "draft",
});

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

/**
 * Site admin > Episodes. The site owner enters each episode's big facts once; commissioners
 * then get an "Episode N results are in" card with one Apply tap.
 */
export function EpisodeResultsManager() {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const currentSeason = parseInt((settings.current_season || "").match(/\d{1,4}/)?.[0] || "", 10) || undefined;
  const [season, setSeason] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!season && currentSeason) setSeason(currentSeason);
  }, [currentSeason, season]);

  const { results, loading, error, save } = useAdminEpisodeResults(season);
  const [cast, setCast] = useState<CastRow[]>([]);
  const [episode, setEpisode] = useState<number>(1);
  const [form, setForm] = useState<EpisodeResult | null>(null);
  const [showFinale, setShowFinale] = useState(false);
  const [saving, setSaving] = useState(false);

  // Official cast for the season
  useEffect(() => {
    if (!season) return;
    supabase
      .from("master_contestants")
      .select("name, tribe")
      .eq("season_number", season)
      .order("name")
      .then(({ data }) => setCast((data as CastRow[]) || []));
  }, [season]);

  // Open on the next episode that has no results yet (once per season, not after every save)
  const openedFor = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (loading || !season || openedFor.current === season) return;
    openedFor.current = season;
    const maxEp = results.reduce((m, r) => Math.max(m, r.episode), 0);
    setEpisode(maxEp > 0 ? maxEp + (results.find((r) => r.episode === maxEp)?.status === "published" ? 1 : 0) : 1);
  }, [loading, season, results]);

  const existing = results.find((r) => r.episode === episode);
  useEffect(() => {
    if (!season) return;
    const base = existing ? { ...existing } : empty(season, episode);
    setForm(base);
    setShowFinale(!!(base.final_tribal.length || base.winner));
  }, [season, episode, existing]);

  // Who had already left before this episode (from saved results)
  const outBefore = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      if (r.episode >= episode) continue;
      for (const n of [...r.voted_out, ...r.quit]) if (!m.has(n)) m.set(n, r.episode);
    }
    return m;
  }, [results, episode]);

  if (!season || !form) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const set = (patch: Partial<EpisodeResult>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const warnings: string[] = [];
  const both = form.voted_out.filter((n) => form.immunity.includes(n));
  if (both.length) warnings.push(`${both.join(", ")} can't be voted out and win immunity in the same episode.`);
  const already = [...form.voted_out, ...form.quit].filter((n) => outBefore.has(n));
  if (already.length) warnings.push(`${already.join(", ")} already left in an earlier episode.`);
  if (!form.voted_out.length && !form.quit.length) warnings.push("Nobody left this episode. Is that right?");
  const blocking = both.length > 0;

  const doSave = async (publish: boolean | null) => {
    setSaving(true);
    try {
      await save({ ...form, season, episode }, publish, user?.id);
      toast.success(
        publish === true
          ? `Episode ${episode} is live. Commissioners will see "Episode ${episode} results are in".`
          : publish === false
          ? `Episode ${episode} is back to draft. Commissioners won't see it.`
          : `Episode ${episode} saved`
      );
    } catch (err: any) {
      toast.error(`Couldn't save: ${err?.message || "try again"}`);
    } finally {
      setSaving(false);
    }
  };

  const isPublished = existing?.status === "published";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5 text-muted-foreground" />
            Episode results
          </CardTitle>
          <CardDescription>
            Enter each episode once after it airs. When you publish, every drafted full-fantasy league on Season {season}{" "}
            gets an "Episode results are in" card, and one tap adds voted out, survival, immunity, jury and finale points.
            Cries, Jeff tosses, idols and bonuses stay with commissioners.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-3 text-sm">
              Couldn't load results: {error}. If this says the table doesn't exist, the database change for auto-scoring
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
                value={season}
                onChange={(e) => setSeason(parseInt(e.target.value) || season)}
                className="w-24 font-extrabold tabular"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er-episode" className="label-caps text-muted-foreground">Episode</Label>
              <Input
                id="er-episode"
                type="number"
                min={1}
                max={30}
                value={episode}
                onChange={(e) => setEpisode(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 font-extrabold tabular"
              />
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
          </div>

          {cast.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No official cast found for Season {season}. Import it in the Cast tab first.
            </p>
          ) : (
            <>
              <CastPicker
                id="er-out"
                label="Voted out"
                cast={cast}
                value={form.voted_out}
                onChange={(v) => set({ voted_out: v })}
                outBefore={outBefore}
              />
              <CastPicker
                id="er-quit"
                label="Quit, medevac or removed"
                cast={cast}
                value={form.quit}
                onChange={(v) => set({ quit: v })}
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
                    <span className="text-muted-foreground">Everyone still in gets the post-merge survival points.</span>
                  </span>
                </label>
                <label htmlFor="er-jury" className="glass rounded-[12px] flex items-start gap-3 p-3 cursor-pointer">
                  <Switch id="er-jury" checked={form.jury_starts} onCheckedChange={(v) => set({ jury_starts: v })} />
                  <span className="text-sm">
                    <b className="block">The jury starts this episode</b>
                    <span className="text-muted-foreground">Everyone still in after this episode gets Make Jury, once.</span>
                  </span>
                </label>
              </div>

              {!showFinale ? (
                <Button type="button" variant="ghost" className="h-11" onClick={() => setShowFinale(true)}>
                  This is the finale
                </Button>
              ) : (
                <div className="space-y-4 rounded-[12px] border-2 border-border p-4">
                  <CastPicker
                    id="er-ftc"
                    label="Made Final Tribal"
                    cast={cast}
                    value={form.final_tribal}
                    onChange={(v) => set({ final_tribal: v })}
                    outBefore={outBefore}
                  />
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
                    <p className="text-xs text-muted-foreground">Adding the winner also marks each league's season as finished.</p>
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

              <div className="flex flex-wrap gap-3">
                <Button variant="accent" className="h-11" onClick={() => doSave(true)} disabled={saving || blocking}>
                  {isPublished ? "Save changes (stays live)" : "Publish to commissioners"}
                </Button>
                {!isPublished && (
                  <Button variant="outline" className="h-11" onClick={() => doSave(null)} disabled={saving || blocking}>
                    Save as draft
                  </Button>
                )}
                {isPublished && (
                  <Button variant="ghost" className="h-11" onClick={() => doSave(false)} disabled={saving}>
                    Unpublish
                  </Button>
                )}
              </div>
              {isPublished && (
                <p className="text-xs text-muted-foreground">
                  Leagues that already applied this episode won't get later edits. Fix those by hand in the league.
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
                  <button
                    type="button"
                    onClick={() => setEpisode(r.episode)}
                    className="text-left min-w-0 hover:underline"
                  >
                    <span className="font-bold tabular">Episode {r.episode}</span>
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      · Out: {[...r.voted_out, ...r.quit].join(", ") || "nobody"}
                      {r.immunity.length ? ` · Immunity: ${r.immunity.join(", ")}` : ""}
                      {r.post_merge ? " · post-merge" : ""}
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
