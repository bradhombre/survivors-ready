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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { LeagueDetailSheet } from "./LeagueDetailSheet";
import { Users, Eye, Trash2, Search, ArrowUpDown, ExternalLink } from "lucide-react";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type StatusFilter = "all" | "active" | "inactive" | "abandoned";
type SortKey = "name" | "member_count" | "last_activity_at" | "created_at" | "mode";

interface LeagueRow {
  id: string;
  name: string;
  created_at: string;
  owner_email: string;
  member_count: number;
  last_activity_at: string | null;
  mode: string | null;
  season: number | null;
  episode: number | null;
  draft_picked: number;
  draft_total: number;
}

function getStatus(lastActivity: string | null): "active" | "inactive" | "abandoned" {
  if (!lastActivity) return "abandoned";
  const days = differenceInDays(new Date(), new Date(lastActivity));
  if (days <= 14) return "active";
  if (days <= 30) return "inactive";
  return "abandoned";
}

const statusColors: Record<string, string> = {
  active: "bg-success text-success-foreground border-transparent",
  inactive: "bg-muted text-foreground border-border",
  abandoned: "bg-destructive text-destructive-foreground border-transparent",
};

export function LeagueManager() {
  const { toast } = useToast();
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last_activity_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [detailLeagueId, setDetailLeagueId] = useState<string | null>(null);

  useEffect(() => {
    fetchLeagues();
  }, []);

  const fetchLeagues = async () => {
    setLoading(true);

    // Fetch leagues
    const { data: leaguesData } = await supabase
      .from("leagues")
      .select("id, name, created_at, owner_id, last_activity_at")
      .order("created_at", { ascending: false });
    if (!leaguesData) { setLoading(false); return; }

    // Fetch owner emails
    const ownerIds = [...new Set(leaguesData.map(l => l.owner_id))];
    const { data: profiles } = await supabase.from("profiles").select("id, email").in("id", ownerIds);
    const profileMap = new Map(profiles?.map(p => [p.id, p.email]) || []);

    // Fetch member counts
    const { data: memberships } = await supabase.from("league_memberships").select("league_id");
    const memberCounts = new Map<string, number>();
    memberships?.forEach(m => {
      if (m.league_id) memberCounts.set(m.league_id, (memberCounts.get(m.league_id) || 0) + 1);
    });

    // Fetch game sessions
    const { data: sessions } = await supabase
      .from("game_sessions")
      .select("league_id, mode, season, episode, id")
      .order("created_at", { ascending: false });

    const sessionMap = new Map<string, { mode: string; season: number; episode: number; id: string }>();
    sessions?.forEach(s => {
      if (s.league_id && !sessionMap.has(s.league_id)) {
        sessionMap.set(s.league_id, { mode: s.mode, season: s.season, episode: s.episode, id: s.id });
      }
    });

    // Fetch contestant draft progress per session
    const sessionIds = [...sessionMap.values()].map(s => s.id);
    const { data: contestants } = await supabase
      .from("contestants")
      .select("session_id, owner")
      .in("session_id", sessionIds.length > 0 ? sessionIds : ["00000000-0000-0000-0000-000000000000"]);

    const draftProgress = new Map<string, { picked: number; total: number }>();
    contestants?.forEach(c => {
      const entry = draftProgress.get(c.session_id) || { picked: 0, total: 0 };
      entry.total++;
      if (c.owner) entry.picked++;
      draftProgress.set(c.session_id, entry);
    });

    const rows: LeagueRow[] = leaguesData.map(l => {
      const sess = sessionMap.get(l.id);
      const dp = sess ? draftProgress.get(sess.id) : undefined;
      return {
        id: l.id,
        name: l.name,
        created_at: l.created_at || "",
        owner_email: profileMap.get(l.owner_id) || "Unknown",
        member_count: memberCounts.get(l.id) || 0,
        last_activity_at: l.last_activity_at,
        mode: sess?.mode || null,
        season: sess?.season || null,
        episode: sess?.episode || null,
        draft_picked: dp?.picked || 0,
        draft_total: dp?.total || 0,
      };
    });

    setLeagues(rows);
    setLoading(false);
  };

  const handleDelete = async (id: string, name: string) => {
    setDeletingIds(prev => new Set(prev).add(id));
    const { error } = await supabase.from("leagues").delete().eq("id", id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Deleted", description: `"${name}" removed.` });
      setLeagues(prev => prev.filter(l => l.id !== id));
      setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
    setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const handleBulkDelete = async () => {
    const toDelete = [...selected];
    for (const id of toDelete) {
      const league = leagues.find(l => l.id === id);
      await handleDelete(id, league?.name || "");
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let result = leagues;
    if (filter !== "all") result = result.filter(l => getStatus(l.last_activity_at) === filter);
    if (search) result = result.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.owner_email.toLowerCase().includes(search.toLowerCase()));
    result.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else if (sortKey === "member_count") cmp = a.member_count - b.member_count;
      else if (sortKey === "last_activity_at") cmp = new Date(a.last_activity_at || 0).getTime() - new Date(b.last_activity_at || 0).getTime();
      else if (sortKey === "created_at") cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (sortKey === "mode") cmp = (a.mode || "").localeCompare(b.mode || "");
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [leagues, filter, search, sortKey, sortAsc]);

  const allSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));

  const counts = useMemo(() => ({
    all: leagues.length,
    active: leagues.filter(l => getStatus(l.last_activity_at) === "active").length,
    inactive: leagues.filter(l => getStatus(l.last_activity_at) === "inactive").length,
    abandoned: leagues.filter(l => getStatus(l.last_activity_at) === "abandoned").length,
  }), [leagues]);

  const SortHeader = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <button onClick={() => toggleSort(sortKeyVal)} className="label-caps flex items-center gap-1 hover:text-foreground transition-colors">
      {label} <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-3xl">
            <Users className="h-5 w-5 text-muted-foreground" />
            All leagues <span className="tabular">({leagues.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "active", "inactive", "abandoned"] as StatusFilter[]).map(f => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                className="rounded-full tabular"
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </Button>
            ))}
            <div className="relative w-full sm:w-auto sm:ml-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leagues..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 w-full sm:w-60"
              />
            </div>
          </div>

          {/* Bulk actions */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-2">
              <span className="text-sm font-bold tabular">{selected.size} selected</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-1" /> Delete selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selected.size} leagues?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove all selected leagues and their data. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Delete all
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="font-display text-2xl leading-none text-muted-foreground text-center py-10">No leagues found</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={checked => {
                        if (checked) setSelected(new Set(filtered.map(l => l.id)));
                        else setSelected(new Set());
                      }}
                    />
                  </TableHead>
                  <TableHead><SortHeader label="Name" sortKeyVal="name" /></TableHead>
                  <TableHead className="label-caps">Owner</TableHead>
                  <TableHead className="text-center"><SortHeader label="Members" sortKeyVal="member_count" /></TableHead>
                  <TableHead><SortHeader label="Mode" sortKeyVal="mode" /></TableHead>
                  <TableHead className="label-caps">Draft</TableHead>
                  <TableHead><SortHeader label="Last activity" sortKeyVal="last_activity_at" /></TableHead>
                  <TableHead className="label-caps">Status</TableHead>
                  <TableHead className="label-caps text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(league => {
                  const status = getStatus(league.last_activity_at);
                  return (
                    <TableRow key={league.id}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(league.id)}
                          onCheckedChange={checked => {
                            const s = new Set(selected);
                            if (checked) s.add(league.id); else s.delete(league.id);
                            setSelected(s);
                          }}
                        />
                      </TableCell>
                      <TableCell className="font-bold">{league.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{league.owner_email}</TableCell>
                      <TableCell className="text-center font-extrabold tabular">{league.member_count}</TableCell>
                      <TableCell>
                        {league.mode ? (
                          <Badge variant="outline" className="capitalize text-xs">{league.mode}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs font-semibold tabular">
                        {league.draft_total > 0 ? `${league.draft_picked}/${league.draft_total}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {league.last_activity_at
                          ? formatDistanceToNow(new Date(league.last_activity_at), { addSuffix: true })
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize text-xs ${statusColors[status]}`}>
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailLeagueId(league.id)}>
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button variant="ghost" size="sm" asChild>
                            <a href={`/league/${league.id}`} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1" /> Visit
                            </a>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={deletingIds.has(league.id)} aria-label={`Delete ${league.name}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete league</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{league.name}"? This will permanently remove the league and all data.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(league.id, league.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
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
