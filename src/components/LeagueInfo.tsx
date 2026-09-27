import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Copy, Save, Users, Link2, Pencil, Trash2, ShieldPlus, ExternalLink, LogOut, UserCircle, Check, X } from "lucide-react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/customerio";
import { QRCodeSVG } from "qrcode.react";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { TeamAvatarUpload } from "./TeamAvatarUpload";

interface LeagueInfoProps {
  leagueId: string;
}

interface LeagueData {
  name: string;
  invite_code: string;
  owner_id: string;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  email: string;
}

export function LeagueInfo({ leagueId }: LeagueInfoProps) {
  const navigate = useNavigate();
  const [league, setLeague] = useState<LeagueData | null>(null);
  const [leagueName, setLeagueName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // My Team state
  const { teams, getMyTeam, updateTeam } = useLeagueTeams({ leagueId });
  const myTeam = getMyTeam(currentUserId);
  const [editingMyTeam, setEditingMyTeam] = useState(false);
  const [myTeamName, setMyTeamName] = useState("");
  const [savingMyTeam, setSavingMyTeam] = useState(false);


  useEffect(() => {
    const fetchData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
      }

      const { data: leagueData, error: leagueError } = await supabase
        .from("leagues")
        .select("name, invite_code, owner_id")
        .eq("id", leagueId)
        .single();

      if (leagueError) {
        toast.error("Failed to load league settings");
        return;
      }

      setLeague({
        name: leagueData.name,
        invite_code: leagueData.invite_code,
        owner_id: leagueData.owner_id,
      });
      setLeagueName(leagueData.name);

      const { data: memberships, error: membersError } = await supabase
        .from("league_memberships")
        .select("id, role, joined_at, user_id")
        .eq("league_id", leagueId);

      if (membersError) {
        toast.error("Failed to load members");
        setLoading(false);
        return;
      }

      if (memberships && memberships.length > 0) {
        const userIds = memberships.map(m => m.user_id);
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", userIds);

        const membersWithEmail = memberships.map(m => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          joined_at: m.joined_at || "",
          email: profiles?.find(p => p.id === m.user_id)?.email || "Unknown",
        }));

        setMembers(membersWithEmail);
      }

      setLoading(false);
    };

    fetchData();
  }, [leagueId]);

  // Sync myTeamName when myTeam changes
  useEffect(() => {
    if (myTeam && !editingMyTeam) {
      setMyTeamName(myTeam.name);
    }
  }, [myTeam, editingMyTeam]);

  const handleSaveMyTeamName = async () => {
    if (!myTeam || !myTeamName.trim()) return;
    
    setSavingMyTeam(true);
    try {
      await updateTeam(myTeam.id, { name: myTeamName.trim() });
      toast.success("Team name updated!");
      setEditingMyTeam(false);
    } catch (err) {
      toast.error("Failed to update team name");
    }
    setSavingMyTeam(false);
  };


  const handleSaveName = async () => {
    if (!leagueName.trim()) {
      toast.error("League name cannot be empty");
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("leagues")
      .update({ name: leagueName.trim() })
      .eq("id", leagueId);

    if (error) {
      toast.error("Failed to update league name");
    } else {
      toast.success("League name updated");
      setLeague(prev => prev ? { ...prev, name: leagueName.trim() } : null);
    }
    setSaving(false);
  };

  const handleCopyInviteCode = () => {
    if (league?.invite_code) {
      navigator.clipboard.writeText(league.invite_code);
      toast.success("Invite code copied to clipboard");
      trackEvent('league_invite_sent', {
        league_name: league.name,
        invite_url: `${window.location.origin}/join/${league.invite_code}`,
      });
    }
  };

  const handleCopyInviteLink = () => {
    if (league?.invite_code) {
      const link = `${window.location.origin}/join/${league.invite_code}`;
      navigator.clipboard.writeText(link);
      toast.success("Invite link copied to clipboard");
      trackEvent('league_invite_sent', {
        league_name: league.name,
        invite_url: link,
      });
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "league_admin":
        return "default";
      case "super_admin":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const isOwner = currentUserId === league?.owner_id;

  const handleRemoveMember = async (memberId: string, memberEmail: string, memberUserId: string) => {
    const { error } = await (supabase.rpc as any)("remove_league_member", {
      _league_id: leagueId,
      _user_id: memberUserId,
    });

    if (error) {
      toast.error("Failed to remove member: " + error.message);
    } else {
      toast.success(`${memberEmail} removed from league`);
      setMembers(prev => prev.filter(m => m.id !== memberId));
    }
  };

  const handlePromoteToAdmin = async (memberId: string, memberEmail: string) => {
    const { error } = await supabase
      .from("league_memberships")
      .update({ role: "league_admin" })
      .eq("id", memberId);

    if (error) {
      toast.error("Failed to promote member");
    } else {
      toast.success(`${memberEmail} is now a co-commissioner`);
      setMembers(prev => prev.map(m => 
        m.id === memberId ? { ...m, role: "league_admin" } : m
      ));
    }
  };

  const canManageMember = (member: Member) => {
    if (member.user_id === currentUserId) return false;
    if (member.role === "league_admin" || member.role === "super_admin") return false;
    return isOwner;
  };

  const handleLeaveLeague = async () => {
    if (!currentUserId) return;
    
    setIsLeaving(true);
    const { error } = await supabase
      .from("league_memberships")
      .delete()
      .eq("league_id", leagueId)
      .eq("user_id", currentUserId);

    if (error) {
      toast.error("Failed to leave league");
      setIsLeaving(false);
    } else {
      toast.success("You have left the league");
      navigate("/leagues");
    }
  };

  const handleDeleteLeague = async () => {
    setIsDeleting(true);
    const { error } = await supabase.rpc("delete_league", { league_uuid: leagueId });

    if (error) {
      toast.error("Failed to delete league: " + error.message);
      setIsDeleting(false);
    } else {
      toast.success("League deleted successfully");
      navigate("/leagues");
    }
  };

  if (loading) {
    return (
      <div className="container max-w-4xl mx-auto p-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-6">
      {/* My Team Section */}
      {myTeam && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-3xl">
              <UserCircle className="h-6 w-6 shrink-0 text-muted-foreground" />
              My team
            </CardTitle>
            <CardDescription>
              Customize your team name and photo
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row items-center gap-6">
              {/* Avatar */}
              <TeamAvatarUpload
                teamId={myTeam.id}
                leagueId={leagueId}
                currentAvatarUrl={myTeam.avatar_url}
                teamName={myTeam.name}
                onUploadComplete={() => {}}
                size="lg"
              />

              {/* Team info */}
              <div className="flex-1 space-y-3 w-full">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="outline" className="tabular">Position #{myTeam.position}</Badge>
                </div>

                {editingMyTeam ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={myTeamName}
                      onChange={(e) => setMyTeamName(e.target.value)}
                      placeholder="Enter team name"
                      className="flex-1"
                      maxLength={50}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveMyTeamName();
                        if (e.key === "Escape") {
                          setEditingMyTeam(false);
                          setMyTeamName(myTeam.name);
                        }
                      }}
                      autoFocus
                    />
                    <Button onClick={handleSaveMyTeamName} size="icon" disabled={savingMyTeam || !myTeamName.trim()} aria-label="Save team name">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button onClick={() => { setEditingMyTeam(false); setMyTeamName(myTeam.name); }} size="icon" variant="ghost" aria-label="Cancel">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-3xl leading-none break-words min-w-0">{myTeam.name}</h3>
                    <Button onClick={() => setEditingMyTeam(true)} size="icon" variant="ghost" className="shrink-0 text-muted-foreground" aria-label="Edit team name">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* League Name Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 shrink-0 text-muted-foreground" />
            League name
          </CardTitle>
          <CardDescription>
            {isOwner ? "Edit your league's display name" : "View the league name"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              aria-label="League name"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              placeholder="Enter league name"
              disabled={!isOwner}
              className="max-w-md"
            />
            {isOwner && (
              <Button onClick={handleSaveName} disabled={saving || leagueName === league?.name} className="shrink-0">
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
          {!isOwner && (
            <p className="text-sm text-muted-foreground mt-2">
              Only the league owner can edit the name.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invite Code Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 shrink-0 text-muted-foreground" />
            Invite code
          </CardTitle>
          <CardDescription>
            Share this code with others to let them join your league
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-stretch gap-3">
            <div className="glass rounded-[12px] px-5 py-3">
              <p className="label-caps text-muted-foreground">Invite code</p>
              <p className="mt-1 select-all text-4xl font-black leading-none tracking-[0.18em] tabular">
                {league?.invite_code || "—"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={handleCopyInviteCode}>
                <Copy className="h-4 w-4" />
                Copy code
              </Button>
              <Button variant="accent" onClick={handleCopyInviteLink}>
                <ExternalLink className="h-4 w-4" />
                Copy link
              </Button>
            </div>
          </div>

          {league?.invite_code && (
            <div className="flex flex-col items-center sm:items-start gap-2">
              <p className="label-caps text-muted-foreground">Scan to join</p>
              <div className="bg-white p-3 rounded-[12px] border-2 border-plank">
                <QRCodeSVG 
                  value={`${window.location.origin}/join/${league.invite_code}`}
                  size={160}
                  level="M"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Members Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
            Members
          </CardTitle>
          <CardDescription className="tabular">
            {members.length} member{members.length !== 1 ? "s" : ""} in this league
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
              {members.map((member) => (
                <li key={member.id} className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="truncate font-bold">
                      {member.email}
                      {member.user_id === currentUserId && (
                        <span className="text-muted-foreground font-normal ml-2">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground tabular">
                      Joined {formatDate(member.joined_at)}
                    </p>
                  </div>
                  <Badge variant={getRoleBadgeVariant(member.role)}>
                    {member.role === "league_admin" ? "Commissioner" : member.role === "super_admin" ? "Site owner" : member.role === "player" ? "Player" : member.role.replace("_", " ")}
                  </Badge>
                  {isOwner && (
                    <div className="ml-auto">
                      {canManageMember(member) ? (
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePromoteToAdmin(member.id, member.email)}
                            title="Make co-commissioner"
                            aria-label={`Make ${member.email} a co-commissioner`}
                          >
                            <ShieldPlus className="h-4 w-4" />
                            Promote
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="destructive" size="sm">
                                <Trash2 className="h-4 w-4" />
                                Remove
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove member</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove {member.email} from this league? 
                                  They will need to rejoin using the invite code.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleRemoveMember(member.id, member.email, member.user_id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>

      {/* Leave League Section - Only for non-owners */}
      {!isOwner && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <LogOut className="h-5 w-5 shrink-0" />
              Leave league
            </CardTitle>
            <CardDescription>
              Leave this league and remove yourself from all associated data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isLeaving}>
                  <LogOut className="h-4 w-4" />
                  {isLeaving ? "Leaving..." : "Leave league"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Leave league</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to leave "{league?.name}"? You will need a new invite code to rejoin.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleLeaveLeague} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Leave
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

      {/* Delete League Section - Only for owners */}
      {isOwner && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5 shrink-0" />
              Delete league
            </CardTitle>
            <CardDescription>
              Permanently delete this league and all associated data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isDeleting}>
                  <Trash2 className="h-4 w-4" />
                  {isDeleting ? "Deleting..." : "Delete league"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete league</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to permanently delete "{league?.name}"? This will remove all members, teams, game data, chat messages, and scoring history. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteLeague} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
