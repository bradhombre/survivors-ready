import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LeagueDetailSheet } from "./LeagueDetailSheet";
import { Users, Eye, Search, ArrowUpDown, ExternalLink, Archive, ArchiveRestore, Copy, RefreshCw } from "lucide-react";
import { formatDistanceToNow, differenceInDays } from "date-fns";
import { useNotify as useToast } from "@/lib/notify";

// One row per league from the admin_league_health() database function (site owner only).
// "Last activity" there counts only things people do: chat (not JeffBot), scoring,
// draft picks, someone joining, a new season starting.
interface LeagueHealth {
  id: string;
  name: string;
  owner_id: string;
  owner_email: string | null;
  created_at: string;
  archived_at: string | null;
  last_activity_at: string | null;
  last_member_sign_in: string | null;
  member_count: number;
  season: number | null;
  episode: number | null;
  game_type: string | null;
  mode: string | null;
  cast_count: number;
  drafted_count: number;
  season_scoring_events: number;
  scored_episodes: number;
  ever_scored: boolean;
  ever_drafted: boolean;
  current_season: number | null;
  stage: Stage;
}

type Stage =
  | "playing"
  | "stopped_scoring"
  | "needs_scoring"
  | "ready_to_draft"
  | "needs_players"
  | "not_rolled_over"
  | "fizzled"
  | "never_started";

type View = "nudge" | "playing" | "candidates" | "archived" | "all";
type SortKey = "priority" | "name" | "member_count" | "last_activity_at" | "last_member_sign_in" | "created_at";

// Idle this long (and never got going) = archive candidate.
const ARCHIVE_AFTER_DAYS = 30;

const NUDGE_STAGES: Stage[] = ["stopped_scoring", "needs_scoring", "ready_to_draft", "needs_players", "not_rolled_over"];

function stageInfo(stage: Stage, currentSeason: number | null): { label: string; hint: string; className: string } {
  const s = currentSeason ? `Season ${currentSeason}` : "the new season";
  switch (stage) {
    case "playing":
      return { label: "Playing", hint: "Scoring this season", className: "bg-success text-success-foreground border-transparent" };
    case "stopped_scoring":
      return { label: "Stopped scoring", hint: "Scored earlier, quiet for 2+ weeks. Nudge the commissioner to catch up", className: "bg-accent/20 text-foreground border-accent" };
    case "needs_scoring":
      return { label: "Drafted, no scores", hint: "Drafted but no episode scored yet. Nudge to score", className: "bg-accent/20 text-foreground border-accent" };
    case "ready_to_draft":
      return { label: "Ready to draft", hint: "Has players, hasn't drafted. Nudge to draft", className: "bg-accent/20 text-foreground border-accent" };
    case "needs_players":
      return { label: "Needs players", hint: "Commissioner is alone. Nudge to share the invite code", className: "bg-accent/20 text-foreground border-accent" };
    case "not_rolled_over":
      return { label: `Hasn't started S${currentSeason ?? "?"}`, hint: `Played before. Nudge to start ${s}`, className: "bg-primary/15 text-foreground border-primary" };
    case "fizzled":
      return { label: "Drafted, never scored", hint: "An older league that stalled after the draft", className: "bg-muted text-muted-foreground border-border" };
    case "never_started":
    default:
      return { label: "Never started", hint: "Created, nothing drafted or scored", className: "bg-muted text-muted-foreground border-border" };
  }
}

function idleDays(l: LeagueHealth): number {
  return differenceInDays(new Date(), new Date(l.last_activity_at || l.created_at));
}

function isArchiveCandidate(l: LeagueHealth): boolean {
  return !l.archived_at && (l.stage === "fizzled" || l.stage === "never_started") && idleDays(l) >= ARCHIVE_AFTER_DAYS;
}

function inView(l: LeagueHealth, view: View): boolean {
  if (view === "all") return true;
  if (view === "archived") return !!l.archived_at;
  if (l.archived_at) return false;
  if (view === "playing") return l.stage === "playing";
  if (view === "nudge") return NUDGE_STAGES.includes(l.stage);
  return isArchiveCandidate(l);
}

function ago(d: string | null): string {
  return d ? formatDistanceToNow(new Date(d), { addSuffix: true }) : "Never";
}

export function LeagueManager() {
  const { toast } = useToast();
  const [leagues, setLeagues] = useState<LeagueHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>("nudge");
  const [stageFilter, setStageFilter] = useState<Stage | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [detailLeagueId, setDetailLeagueId] = useState<string | null>(null);

  useEffect(() => {
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    setLoading(true);
    setLoadError(null);
    // Not in the generated Supabase types yet, hence the cast.
    const { data, error } = await (supabase.rpc as any)("admin_league_health");
    if (error) {
      setLoadError(
        error.message?.includes("admin_league_health")
          ? "The league health database update hasn't been run yet."
          : error.message,
      );
      setLeagues([]);
    } else {
      setLeagues((data || []) as LeagueHealth[]);
    }
    setLoading(false);
  };

  const currentSeason = leagues.find(l => l.current_season)?.current_season ?? null;

  const setArchived = async (ids: string[], archive: boolean) => {
    if (ids.length === 0) return;
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("admin_set_league_archived", { league_ids: ids, archive });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    const now = new Date().toISOString();
    setLeagues(prev => prev.map(l => (ids.includes(l.id) ? { ...l, archived_at: archive ? (l.archived_at || now) : null } : l)));
    setSelected(new Set());
    const n = typeof data === "number" ? data : ids.length;
    toast({
      title: archive ? `Archived ${n} league${n === 1 ? "" : "s"}` : `Restored ${n} league${n === 1 ? "" : "s"}`,
      description: archive ? "Players still see them. Any new activity brings a league back automatically." : undefined,
    });
  };

  const copyOwnerEmails = async (ids: string[]) => {
    const emails = [...new Set(leagues.filter(l => ids.includes(l.id)).map(l => l.owner_email).filter(Boolean))] as string[];
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast({ title: `Copied ${emails.length} commissioner email${emails.length === 1 ? "" : "s"}` });
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === "name" || key === "priority"); }
  };

  const counts = useMemo(() => {
    const c: Record<View, number> = { nudge: 0, playing: 0, candidates: 0, archived: 0, all: leagues.length };
    leagues.forEach(l => {
      (["nudge", "playing", "candidates", "archived"] as View[]).forEach(v => { if (inView(l, v)) c[v]++; });
    });
    return c;
  }, [leagues]);

  const stageCounts = useMemo(() => {
    const c = new Map<Stage, number>();
    leagues.filter(l => inView(l, view)).forEach(l => c.set(l.stage, (c.get(l.stage) || 0) + 1));
    return c;
  }, [leagues, view]);

  const filtered = useMemo(() => {
    let result = leagues.filter(l => inView(l, view));
    if (stageFilter) result = result.filter(l => l.stage === stageFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(l => l.name.toLowerCase().includes(q) || (l.owner_email || "").toLowerCase().includes(q));
    }
    const time = (d: string | null) => (d ? new Date(d).getTime() : 0);
    const priority = (s: Stage) => {
      const i = NUDGE_STAGES.indexOf(s);
      return i === -1 ? 99 : i;
    };
    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "priority") {
        // Closest to playing first, then bigger leagues, then most recently active.
        cmp = priority(a.stage) - priority(b.stage)
          || b.member_count - a.member_count
          || time(b.last_activity_at) - time(a.last_activity_at);
      }
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "member_count") cmp = a.member_count - b.member_count;
      else if (sortKey === "last_activity_at") cmp = time(a.last_activity_at) - time(b.last_activity_at);
      else if (sortKey === "last_member_sign_in") cmp = time(a.last_member_sign_in) - time(b.last_member_sign_in);
      else if (sortKey === "created_at") cmp = time(a.created_at) - time(b.created_at);
      return sortAsc ? cmp : -cmp;
    });
  }, [leagues, view, stageFilter, search, sortKey, sortAsc]);

  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));
  const selectedIds = [...selected];
  const selectedArchived = leagues.filter(l => selected.has(l.id) && l.archived_at).length;
  const selectedActive = selected.size - selectedArchived;

  const changeView = (v: View) => {
    setView(v);
    setStageFilter(null);
    setSelected(new Set());
    setSortKey(v === "nudge" ? "priority" : "last_activity_at");
    setSortAsc(v === "nudge");
  };

  const SortHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <button onClick={() => toggleSort(sortKeyVal)} className="label-caps flex items-center gap-1 whitespace-nowrap hover:text-foreground transition-colors">
      {label} <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  const views: { key: View; label: string; help: string }[] = [
    { key: "nudge", label: "Needs a nudge", help: "One step away from playing. Sorted closest-to-playing first, then by league size." },
    { key: "playing", label: "Playing", help: "Scoring this season, with activity in the last 2 weeks." },
    { key: "candidates", label: "Archive candidates", help: `Never drafted or never scored, and nothing has happened in ${ARCHIVE_AFTER_DAYS}+ days.` },
    { key: "archived", label: "Archived", help: "Hidden from these lists only. Players still see their league, and any new activity brings it back here." },
    { key: "all", label: "All", help: "Every league." },
  ];
  const activeView = views.find(v => v.key === view)!;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-3xl">
            <Users className="h-5 w-5 text-muted-foreground" />
            Leagues <span className="tabular">({leagues.length})</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchLeagues} disabled={loading} aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Views */}
          <div className="flex flex-wrap items-center gap-2">
            {views.map(v => (
              <Button
                key={v.key}
                variant={view === v.key ? "default" : "outline"}
                size="sm"
                className="rounded-full tabular"
                onClick={() => changeView(v.key)}
              >
                {v.label} ({counts[v.key]})
              </Button>
            ))}
            <div className="relative w-full sm:w-auto sm:ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search league or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 w-full sm:w-60"
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{activeView.help}</p>

          {/* Stage chips within the view */}
          {stageCounts.size > 1 && (
            <div className="flex flex-wrap gap-2">
              {[...stageCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([stage, n]) => {
                  const info = stageInfo(stage, currentSeason);
                  const on = stageFilter === stage;
                  return (
                    <button
                      key={stage}
                      onClick={() => setStageFilter(on ? null : stage)}
                      className={`rounded-full border-2 px-3 py-1 text-xs font-semibold tabular transition-colors ${on ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"}`}
                      title={info.hint}
                    >
                      {info.label} ({n})
                    </button>
                  );
                })}
            </div>
          )}

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-2">
              <span className="text-sm font-bold tabular mr-1">{selected.size} selected</span>
              {selectedActive > 0 && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setArchived(selectedIds.filter(id => !leagues.find(l => l.id === id)?.archived_at), true)}>
                  <Archive className="h-4 w-4 mr-1" /> Archive {selectedActive}
                </Button>
              )}
              {selectedArchived > 0 && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setArchived(selectedIds.filter(id => !!leagues.find(l => l.id === id)?.archived_at), false)}>
                  <ArchiveRestore className="h-4 w-4 mr-1" /> Restore {selectedArchived}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => copyOwnerEmails(selectedIds)}>
                <Copy className="h-4 w-4 mr-1" /> Copy commissioner emails
              </Button>
            </div>
          )}

          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : loadError ? (
            <p className="text-sm text-destructive text-center py-8">{loadError}</p>
          ) : filtered.length === 0 ? (
            <p className="font-display text-2xl leading-none text-muted-foreground text-center py-10">No leagues here</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      aria-label="Select all"
                      onCheckedChange={checked => {
                        if (checked) setSelected(new Set(filtered.map(l => l.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead><SortHeader label="League" sortKeyVal="name" /></TableHead>
                  <TableHead><SortHeader label="Stage" sortKeyVal="priority" /></TableHead>
                  <TableHead className="text-center"><SortHeader label="Members" sortKeyVal="member_count" /></TableHead>
                  <TableHead className="label-caps">Progress</TableHead>
                  <TableHead className="whitespace-nowrap"><SortHeader label="Last activity" sortKeyVal="last_activity_at" /></TableHead>
                  <TableHead className="whitespace-nowrap"><SortHeader label="Last sign-in" sortKeyVal="last_member_sign_in" /></TableHead>
                  <TableHead className="label-caps text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(league => {
                  const info = stageInfo(league.stage, currentSeason);
                  const progress = [
                    league.season ? `S${league.season}` : null,
                    league.cast_count > 0 ? `${league.drafted_count}/${league.cast_count} drafted` : "no cast",
                    league.season_scoring_events > 0 ? `${league.scored_episodes} ep${league.scored_episodes === 1 ? "" : "s"} scored` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <TableRow key={league.id} className={league.archived_at ? "opacity-60" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(league.id)}
                          aria-label={`Select ${league.name}`}
                          onCheckedChange={checked => {
                            const s = new Set(selected);
                            if (checked) s.add(league.id); else s.delete(league.id);
                            setSelected(s);
                          }}
                        />
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <div className="font-bold">{league.name}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={league.owner_email || undefined}>{league.owner_email || "Unknown"}</div>
                      </TableCell>
                      <TableCell className="min-w-[160px]">
                        <Badge variant="outline" className={`text-xs ${info.className}`}>{info.label}</Badge>
                        {league.archived_at && <Badge variant="outline" className="ml-1 text-xs">Archived</Badge>}
                        <div className="mt-1 text-xs text-muted-foreground">{info.hint}</div>
                      </TableCell>
                      <TableCell className="text-center font-extrabold tabular">{league.member_count}</TableCell>
                      <TableCell className="text-xs font-semibold tabular whitespace-nowrap">{progress}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{ago(league.last_activity_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{ago(league.last_member_sign_in)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailLeagueId(league.id)}>
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/league/${league.id}`} target="_blank" rel="noopener noreferrer" aria-label={`Visit ${league.name}`}>
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => setArchived([league.id], !league.archived_at)}
                            aria-label={league.archived_at ? `Restore ${league.name}` : `Archive ${league.name}`}
                            title={league.archived_at ? "Restore" : "Archive"}
                          >
                            {league.archived_at ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <LeagueDetailSheet
        leagueId={detailLeagueId}
        open={!!detailLeagueId}
        onOpenChange={open => { if (!open) setDetailLeagueId(null); }}
      />
    </>
  );
}
