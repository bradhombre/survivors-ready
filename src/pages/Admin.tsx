import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { NewsManager } from "@/components/admin/NewsManager";
import { CastManager } from "@/components/admin/CastManager";
import { AdminSettings } from "@/components/admin/AdminSettings";
import { LeagueManager } from "@/components/admin/LeagueManager";
import { ArrowLeft, Users, Newspaper, UserCircle, Settings, Bug, Sparkles, Send, Loader2, MessageSquare } from "lucide-react";
import { ChatMonitor } from "@/components/admin/ChatMonitor";
import { Lockup } from "@/components/Lockup";
import { format } from "date-fns";
import { toast } from "sonner";

interface BugReport {
  id: string;
  user_id: string;
  description: string;
  page_url: string | null;
  status: string;
  created_at: string;
  admin_notes: string | null;
  league_id: string | null;
  user_email?: string;
  league_name?: string;
}

export default function Admin() {
  const { isSuperAdmin, loading: roleLoading } = useIsSuperAdmin();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [bugs, setBugs] = useState<BugReport[]>([]);
  const [notesInput, setNotesInput] = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes] = useState<Record<string, boolean>>({});
  const [generatingAI, setGeneratingAI] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    if (!roleLoading && !isSuperAdmin) {
      navigate("/leagues");
    }
  }, [isSuperAdmin, roleLoading, authLoading, user, navigate]);

  useEffect(() => {
    if (!isSuperAdmin || roleLoading) return;
    fetchBugs();
  }, [isSuperAdmin, roleLoading]);

  const fetchBugs = async () => {
    const { data } = await supabase
      .from("bug_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (!data) return;

    const userIds = [...new Set(data.map((b: any) => b.user_id))];
    const leagueIds = [...new Set(data.map((b: any) => b.league_id).filter(Boolean))];

    const [profilesRes, leaguesRes] = await Promise.all([
      supabase.from("profiles").select("id, email").in("id", userIds),
      leagueIds.length > 0
        ? supabase.from("leagues").select("id, name").in("id", leagueIds)
        : Promise.resolve({ data: [] }),
    ]);

    const emailMap = new Map(profilesRes.data?.map((p) => [p.id, p.email]) || []);
    const leagueMap = new Map<string, string>(leaguesRes.data?.map((l: any) => [l.id, l.name] as [string, string]) || []);

    const mapped = data.map((b: any) => ({
      ...b,
      user_email: emailMap.get(b.user_id) || "Unknown",
      league_name: b.league_id ? leagueMap.get(b.league_id) || null : null,
    }));

    setBugs(mapped);
    // Initialize notes inputs
    const notes: Record<string, string> = {};
    mapped.forEach((b: BugReport) => { notes[b.id] = b.admin_notes || ""; });
    setNotesInput(notes);
  };

  const handleUpdateBugStatus = async (id: string, status: string) => {
    await supabase.from("bug_reports").update({ status }).eq("id", id);
    setBugs((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
  };

  const handleSaveNotes = async (id: string) => {
    const notes = notesInput[id]?.trim() || null;
    setSavingNotes((p) => ({ ...p, [id]: true }));
    const { error } = await supabase
      .from("bug_reports")
      .update({ admin_notes: notes, user_viewed_response: false } as any)
      .eq("id", id);
    if (error) {
      toast.error("Failed to save notes");
    } else {
      toast.success("Response saved — user will be notified");
      setBugs((prev) => prev.map((b) => (b.id === id ? { ...b, admin_notes: notes } : b)));
    }
    setSavingNotes((p) => ({ ...p, [id]: false }));
  };

  const handleAISuggest = async (bug: BugReport) => {
    setGeneratingAI((p) => ({ ...p, [bug.id]: true }));
    try {
      const { data: session } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-bug-response`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session?.access_token}`,
          },
          body: JSON.stringify({
            description: bug.description,
            page_url: bug.page_url,
            status: bug.status,
          }),
        }
      );
      if (!resp.ok) throw new Error("AI request failed");
      const { suggestion } = await resp.json();
      setNotesInput((p) => ({ ...p, [bug.id]: suggestion }));
    } catch {
      toast.error("Failed to generate AI suggestion");
    }
    setGeneratingAI((p) => ({ ...p, [bug.id]: false }));
  };

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isSuperAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-header">
        <div className="container mx-auto max-w-6xl px-4 pt-4 pb-5 flex justify-between items-start gap-3">
          <div className="flex flex-col gap-2 min-w-0">
            <Link to="/leagues" className="self-start">
              <Lockup className="text-2xl" />
            </Link>
            <h1 className="label-caps text-header-label">Site admin</h1>
          </div>
          <Link
            to="/leagues"
            className="flex min-h-[44px] items-center gap-2 rounded-[10px] px-2 text-sm font-semibold text-header-label transition-colors hover:text-[hsl(var(--header-fg))]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">My leagues</span>
            <span className="sr-only sm:hidden">Back to my leagues</span>
          </Link>
        </div>
      </header>
      <div className="buff-trim" aria-hidden="true" />

      <main className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
        <Tabs defaultValue="leagues" className="space-y-6">
          <div className="-mx-4 overflow-x-auto px-4">
            <TabsList className="w-max">
              <TabsTrigger value="leagues" className="gap-2">
                <Users className="h-4 w-4" />
                Leagues
              </TabsTrigger>
              <TabsTrigger value="cast" className="gap-2">
                <UserCircle className="h-4 w-4" />
                Cast
              </TabsTrigger>
              <TabsTrigger value="news" className="gap-2">
                <Newspaper className="h-4 w-4" />
                News
              </TabsTrigger>
              <TabsTrigger value="chat" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="bugs" className="gap-2">
                <Bug className="h-4 w-4" />
                Bugs <span className="tabular">({bugs.length})</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="leagues"><LeagueManager /></TabsContent>
          <TabsContent value="cast"><CastManager /></TabsContent>
          <TabsContent value="news"><NewsManager /></TabsContent>
          <TabsContent value="chat"><ChatMonitor /></TabsContent>

          <TabsContent value="bugs">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-3xl">
                  <Bug className="h-5 w-5 text-muted-foreground" />
                  Bug reports
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bugs.length === 0 ? (
                  <p className="font-display text-2xl leading-none text-center text-muted-foreground py-10">No bug reports yet</p>
                ) : (
                  <div className="space-y-4">
                    {bugs
                      .filter((bug) => bug.status !== 'resolved' && bug.status !== 'closed')
                      .map((bug) => (
                      <div key={bug.id} className="glass rounded-[12px] p-4 space-y-3">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span className="text-xs text-muted-foreground">{bug.user_email}</span>
                              <span className="text-xs text-muted-foreground">·</span>
                              <span className="text-xs text-muted-foreground">
                                {format(new Date(bug.created_at), "MMM d, yyyy")}
                              </span>
                              {bug.league_name && (
                                <>
                                  <span className="text-xs text-muted-foreground">·</span>
                                  <span className="text-xs font-bold text-primary">{bug.league_name}</span>
                                </>
                              )}
                            </div>
                            <select
                              value={bug.status}
                              onChange={(e) => handleUpdateBugStatus(bug.id, e.target.value)}
                              className="h-9 rounded-[10px] border-2 border-input bg-card px-2 text-xs font-semibold shrink-0 w-auto max-w-[130px]"
                            >
                              <option value="open">Open</option>
                              <option value="in_progress">In progress</option>
                              <option value="resolved">Resolved</option>
                              <option value="closed">Closed</option>
                            </select>
                          </div>
                          <details className="cursor-pointer">
                            <summary className="text-sm font-semibold">{bug.description}</summary>
                            <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{bug.description}</p>
                          </details>
                          {bug.page_url && (
                            <p className="text-xs text-muted-foreground truncate">{bug.page_url}</p>
                          )}
                        </div>

                        {/* Admin notes section */}
                        <div className="space-y-2 pt-2 border-t border-border">
                          <div className="flex items-center justify-between">
                            <span className="label-caps text-muted-foreground">Admin response</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => handleAISuggest(bug)}
                              disabled={generatingAI[bug.id]}
                            >
                              {generatingAI[bug.id] ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3" />
                              )}
                              AI suggest
                            </Button>
                          </div>
                          <Textarea
                            placeholder="Write a response to the user..."
                            value={notesInput[bug.id] || ""}
                            onChange={(e) => setNotesInput((p) => ({ ...p, [bug.id]: e.target.value }))}
                            rows={2}
                            className="text-sm"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              className="gap-1"
                              onClick={() => handleSaveNotes(bug.id)}
                              disabled={savingNotes[bug.id] || (notesInput[bug.id] || "") === (bug.admin_notes || "")}
                            >
                              {savingNotes[bug.id] ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                              Send response
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {bugs.filter((bug) => bug.status === 'resolved' || bug.status === 'closed').length > 0 && (
                      <details className="mt-6">
                        <summary className="cursor-pointer text-sm font-semibold text-muted-foreground tabular hover:text-foreground transition-colors">
                          {bugs.filter((bug) => bug.status === 'resolved' || bug.status === 'closed').length} resolved/closed report(s)
                        </summary>
                        <div className="space-y-4 mt-4">
                          {bugs
                            .filter((bug) => bug.status === 'resolved' || bug.status === 'closed')
                            .map((bug) => (
                              <div key={bug.id} className="glass rounded-[12px] p-4 space-y-3 opacity-60">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                                      <span className="text-xs text-muted-foreground">{bug.user_email}</span>
                                      <span className="text-xs text-muted-foreground">·</span>
                                      <span className="text-xs text-muted-foreground">
                                        {format(new Date(bug.created_at), "MMM d, yyyy")}
                                      </span>
                                    </div>
                                    <select
                                      value={bug.status}
                                      onChange={(e) => handleUpdateBugStatus(bug.id, e.target.value)}
                                      className="h-9 rounded-[10px] border-2 border-input bg-card px-2 text-xs font-semibold shrink-0 w-auto max-w-[130px]"
                                    >
                                      <option value="open">Open</option>
                                      <option value="in_progress">In progress</option>
                                      <option value="resolved">Resolved</option>
                                      <option value="closed">Closed</option>
                                    </select>
                                  </div>
                                  <p className="text-sm">{bug.description}</p>
                                </div>
                              </div>
                            ))}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings"><AdminSettings /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
