import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format, formatDistanceToNow } from "date-fns";
import { Users, Gamepad2, MessageSquare, Trophy, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotify as useToast } from "@/lib/notify";

interface LeagueDetailSheetProps {
  leagueId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LeagueDetail {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  owner_email: string;
  owner_id: string;
  last_activity_at: string | null;
  session?: {
    mode: string;
    season: number;
    episode: number;
    draft_type: string;
    game_type: string;
  };
  members: { user_id: string; email: string; display_name: string | null; role: string; team_name: string | null }[];
  contestants: { name: string; owner: string | null; is_eliminated: boolean }[];
  recentMessages: { content: string; user_email: string; created_at: string; is_bot: boolean }[];
  scoringEventsCount: number;
}

export function LeagueDetailSheet({ leagueId, open, onOpenChange }: LeagueDetailSheetProps) {
  const [detail, setDetail] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!leagueId || !open) return;
    fetchDetail(leagueId);
  }, [leagueId, open]);

  const fetchDetail = async (id: string) => {
    setLoading(true);
    try {
      // Fetch league
      const { data: league } = await supabase
        .from("leagues")
        .select("id, name, invite_code, created_at, owner_id, last_activity_at")
        .eq("id", id)
        .single();
      if (!league) return;

      // Fetch owner email
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("email")
        .eq("id", league.owner_id)
        .single();

      // Fetch game session
      const { data: sessions } = await supabase
        .from("game_sessions")
        .select("mode, season, episode, draft_type, game_type, id")
        .eq("league_id", id)
        .order("created_at", { ascending: false })
        .limit(1);
      const session = sessions?.[0];

      // Fetch memberships
      const { data: memberships } = await supabase
        .from("league_memberships")
        .select("user_id, role")
        .eq("league_id", id);

      // Fetch teams
      const { data: teams } = await supabase
        .from("league_teams")
        .select("user_id, name")
        .eq("league_id", id);

      // Fetch profiles for members
      const userIds = memberships?.map(m => m.user_id) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", userIds);
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      const teamMap = new Map(teams?.filter(t => t.user_id).map(t => [t.user_id, t.name]) || []);

      const members = (memberships || []).map(m => {
        const prof = profileMap.get(m.user_id);
        return {
          user_id: m.user_id,
          email: prof?.email || "Unknown",
          display_name: prof?.display_name || null,
          role: m.role,
          team_name: teamMap.get(m.user_id) || null,
        };
      });

      // Fetch contestants
      let contestants: LeagueDetail["contestants"] = [];
      if (session) {
        const { data: contestantsData } = await supabase
          .from("contestants")
          .select("name, owner, is_eliminated")
          .eq("session_id", session.id)
          .order("pick_number", { ascending: true });
        contestants = contestantsData || [];
      }

      // Fetch recent chat messages
      const { data: messages } = await supabase
        .from("chat_messages")
        .select("content, user_id, created_at, is_bot")
        .eq("league_id", id)
        .order("created_at", { ascending: false })
        .limit(10);

      const msgUserIds = [...new Set(messages?.map(m => m.user_id) || [])];
      const { data: msgProfiles } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", msgUserIds);
      const msgProfileMap = new Map(msgProfiles?.map(p => [p.id, p.email]) || []);

      const recentMessages = (messages || []).reverse().map(m => ({
        content: m.content,
        user_email: m.is_bot ? "JeffBot" : (msgProfileMap.get(m.user_id) || "Unknown"),
        created_at: m.created_at,
        is_bot: m.is_bot,
      }));

      // Scoring events count
      let scoringEventsCount = 0;
      if (session) {
        const { count } = await supabase
          .from("scoring_events")
          .select("id", { count: "exact", head: true })
          .eq("session_id", session.id);
        scoringEventsCount = count || 0;
      }

      setDetail({
        id: league.id,
        name: league.name,
        invite_code: league.invite_code,
        created_at: league.created_at || "",
        owner_email: ownerProfile?.email || "Unknown",
        owner_id: league.owner_id,
        last_activity_at: league.last_activity_at,
        session: session ? {
          mode: session.mode,
          season: session.season,
          episode: session.episode,
          draft_type: session.draft_type,
          game_type: session.game_type,
        } : undefined,
        members,
        contestants,
        recentMessages,
        scoringEventsCount,
      });
    } finally {
      setLoading(false);
    }
  };

  const copyInviteCode = () => {
    if (detail) {
      navigator.clipboard.writeText(detail.invite_code);
      toast({ title: "Invite code copied!" });
    }
  };

  const pickedCount = detail?.contestants.filter(c => c.owner).length || 0;
  const totalCount = detail?.contestants.length || 0;
  const eliminatedCount = detail?.contestants.filter(c => c.is_eliminated).length || 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0 space-y-1 text-left">
              <p className="label-caps text-muted-foreground">League</p>
              <SheetTitle className="font-display text-3xl leading-none break-words">{detail?.name || "League details"}</SheetTitle>
            </div>
            {detail && (
              <Button variant="outline" size="sm" className="shrink-0" asChild>
                <a href={`/league/${detail.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Visit league
                </a>
              </Button>
            )}
          </div>
        </SheetHeader>

        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : detail ? (
          <ScrollArea className="h-[calc(100vh-7rem)] pr-4">
            <div className="space-y-4 pt-4 pb-8">
              {/* Overview */}
              <div className="glass rounded-[12px] px-4 py-1 divide-y divide-border">
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="label-caps text-muted-foreground">Owner</span>
                  <span className="text-sm font-semibold truncate">{detail.owner_email}</span>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="label-caps text-muted-foreground">Invite code</span>
                  <button onClick={copyInviteCode} className="flex min-h-[32px] items-center gap-1.5 text-sm font-mono font-bold tracking-widest hover:text-primary transition-colors">
                    {detail.invite_code} <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="label-caps text-muted-foreground">Created</span>
                  <span className="text-sm font-semibold tabular">{detail.created_at ? format(new Date(detail.created_at), "MMM d, yyyy") : "—"}</span>
                </div>
                {detail.last_activity_at && (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="label-caps text-muted-foreground">Last activity</span>
                    <span className="text-sm font-semibold">{formatDistanceToNow(new Date(detail.last_activity_at), { addSuffix: true })}</span>
                  </div>
                )}
              </div>

              {/* Game State */}
              <div className="glass rounded-[12px] p-4 space-y-3">
                <h4 className="label-caps text-muted-foreground flex items-center gap-2">
                  <Gamepad2 className="h-4 w-4" /> Game state
                </h4>
                {detail.session ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Mode:</span>{" "}
                      <Badge variant="outline" className="capitalize">{detail.session.mode}</Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Season:</span> <span className="font-bold tabular">{detail.session.season}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Episode:</span> <span className="font-bold tabular">{detail.session.episode}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Draft:</span> <span className="font-semibold">{detail.session.draft_type}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Type:</span> <span className="font-semibold">{detail.session.game_type}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No game session</p>
                )}
              </div>

              {/* Members */}
              <div className="glass rounded-[12px] p-4 space-y-2">
                <h4 className="label-caps text-muted-foreground flex items-center gap-2">
                  <Users className="h-4 w-4" /> Members <span className="tabular">({detail.members.length})</span>
                </h4>
                <div className="divide-y divide-border">
                  {detail.members.map(m => (
                    <div key={m.user_id} className="flex items-center justify-between gap-3 text-sm py-2">
                      <div className="min-w-0">
                        <span className="font-semibold">{m.display_name || m.email}</span>
                        {m.team_name && <span className="text-muted-foreground ml-2">({m.team_name})</span>}
                      </div>
                      <Badge variant={m.role === "league_admin" || m.role === "super_admin" ? "default" : "secondary"} className="text-xs shrink-0">
                        {m.role.replace("_", " ")}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Draft Status */}
              <div className="glass rounded-[12px] p-4 space-y-3">
                <h4 className="label-caps text-muted-foreground flex items-center gap-2">
                  <Trophy className="h-4 w-4" /> Contestants
                </h4>
                <p className="text-sm text-muted-foreground tabular">
                  <span className="font-bold text-foreground">{pickedCount}/{totalCount}</span> drafted, <span className="font-bold text-foreground">{eliminatedCount}</span> eliminated
                </p>
                {detail.contestants.length > 0 ? (
                  <div className="grid grid-cols-2 gap-1">
                    {detail.contestants.map(c => (
                      <div key={c.name} className={`text-xs py-1 px-2 rounded-[8px] ${c.is_eliminated ? "line-through text-muted-foreground" : "font-semibold"}`}>
                        {c.name}
                        {c.owner && <span className="font-normal text-muted-foreground ml-1">→ {c.owner}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No contestants loaded</p>
                )}
              </div>

              {/* Recent Chat */}
              <div className="glass rounded-[12px] p-4 space-y-3">
                <h4 className="label-caps text-muted-foreground flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" /> Recent chat <span className="tabular">({detail.recentMessages.length})</span>
                </h4>
                {detail.recentMessages.length > 0 ? (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {detail.recentMessages.map((msg, i) => (
                      <div key={i} className="text-xs">
                        <span className={`font-bold ${msg.is_bot ? "text-primary" : ""}`}>{msg.user_email}:</span>{" "}
                        <span className="text-muted-foreground">{msg.content.slice(0, 120)}{msg.content.length > 120 ? "..." : ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No messages</p>
                )}
              </div>

              {/* Scoring */}
              <div className="glass rounded-[12px] flex items-center justify-between gap-3 px-4 py-3">
                <span className="label-caps text-muted-foreground">Total scoring events</span>
                <span className="text-2xl font-black tabular">{detail.scoringEventsCount}</span>
              </div>
            </div>
          </ScrollArea>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
