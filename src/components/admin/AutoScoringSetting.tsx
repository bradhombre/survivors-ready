import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

// Column newer than the generated Supabase types
const db = supabase as unknown as { from: (table: string) => any };

/**
 * Admin > Scoring: turn auto-scoring on or off for this league. On (the default) shows the
 * "Episode N results are in" card on the Game tab. Off means everything is scored by hand.
 */
export function AutoScoringSetting({ leagueId, onChange }: { leagueId: string; onChange?: (on: boolean) => void }) {
  const { user } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await db.from("leagues").select("owner_id, auto_scoring").eq("id", leagueId).maybeSingle();
      if (error || !data) {
        setOn(true);
        return;
      }
      setOwnerId(data.owner_id);
      setOn(data.auto_scoring !== false);
    })();
  }, [leagueId]);

  const isOwner = !!user && user.id === ownerId;

  const toggle = async (next: boolean) => {
    setSaving(true);
    const { error } = await db.from("leagues").update({ auto_scoring: next }).eq("id", leagueId);
    setSaving(false);
    if (error) {
      toast.error("Couldn't save. Try again.");
      return;
    }
    setOn(next);
    onChange?.(next);
    toast.success(next ? "Auto-scoring is on" : "Auto-scoring is off. Score each episode by hand on the Game tab.");
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-3xl">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
          Auto-scoring
        </CardTitle>
        <CardDescription className="max-w-[65ch]">
          After each episode airs, we post the results (who went home, immunity, survival points) to a card on your Game
          tab. Nothing changes in your league until you tap Add, you can skip episodes your league didn't play, and you can
          hide the card if you're watching later. Turn it off to score everything by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <label htmlFor="auto-scoring" className="glass rounded-[12px] flex items-start gap-3 p-3 max-w-xl cursor-pointer">
          <Switch
            id="auto-scoring"
            checked={!!on}
            disabled={on === null || saving || !isOwner}
            onCheckedChange={toggle}
          />
          <span className="text-sm">
            <b className="block">{on === null ? "Loading…" : on ? "On" : "Off"}</b>
            <span className="text-muted-foreground">
              {!isOwner && on !== null
                ? "Only the person who created the league can change this."
                : on
                ? "The results card shows up on the Game tab after each episode."
                : "No results card. Score each episode by hand."}
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
