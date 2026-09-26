import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContestantAvatar } from "./ContestantAvatar";
import { Contestant, Player } from "@/types/survivor";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface ManualAssignmentProps {
  contestants: Contestant[];
  draftOrder: Player[];
  picksPerTeam: number;
  onAssign: (contestantId: string, teamName: string) => Promise<void>;
  onFinalize: () => Promise<void>;
}

export const ManualAssignment = ({
  contestants,
  draftOrder,
  picksPerTeam,
  onAssign,
  onFinalize,
}: ManualAssignmentProps) => {
  const [assignments, setAssignments] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    contestants.forEach((c) => {
      if (c.owner) initial[c.id] = c.owner;
    });
    return initial;
  });
  const [isSaving, setIsSaving] = useState(false);

  const teamCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    draftOrder.forEach((t) => (counts[t] = 0));
    Object.values(assignments).forEach((team) => {
      if (team && counts[team] !== undefined) counts[team]++;
    });
    return counts;
  }, [assignments, draftOrder]);

  const handleChange = (contestantId: string, team: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (team === "__unassigned__") {
        delete next[contestantId];
      } else {
        next[contestantId] = team;
      }
      return next;
    });
  };

  const canFinalize = useMemo(() => {
    const assigned = Object.keys(assignments).length;
    return assigned > 0 && Object.values(teamCounts).every((c) => c <= picksPerTeam);
  }, [assignments, teamCounts, picksPerTeam]);

  const handleFinalize = async () => {
    // Validate
    const overLimit = Object.entries(teamCounts).filter(([, c]) => c > picksPerTeam);
    if (overLimit.length > 0) {
      toast.error(`These teams exceed the ${picksPerTeam}-pick limit: ${overLimit.map(([t]) => t).join(", ")}`);
      return;
    }

    setIsSaving(true);
    try {
      // Save all assignments
      let pickNum = 1;
      for (const contestant of contestants) {
        const team = assignments[contestant.id];
        if (team && team !== contestant.owner) {
          await onAssign(contestant.id, team);
        } else if (!team && contestant.owner) {
          // Clear assignment
          await onAssign(contestant.id, "");
        }
        if (team) pickNum++;
      }
      await onFinalize();
      toast.success("Teams assigned! Game is ready.");
    } catch (e) {
      console.error("Finalize error:", e);
      toast.error("Failed to finalize assignments.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-4 sm:p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="font-display text-3xl leading-none">Assign teams by hand</h2>
        <p className="text-muted-foreground text-sm">
          Assign each contestant to a team using the dropdowns, then finalize.
          Each team can have up to {picksPerTeam} contestant{picksPerTeam !== 1 ? "s" : ""}.
        </p>
      </div>

      {/* Team capacity summary */}
      <div className="flex flex-wrap gap-2">
        {draftOrder.map((team) => (
          <span
            key={String(team)}
            className={`text-xs px-3 py-1.5 rounded-full font-bold tabular ${
              teamCounts[team] > picksPerTeam
                ? "bg-destructive text-destructive-foreground"
                : teamCounts[team] === picksPerTeam
                ? "bg-success text-success-foreground"
                : "glass"
            }`}
          >
            {team}: {teamCounts[team]}/{picksPerTeam}
          </span>
        ))}
      </div>

      {/* Contestant list */}
      <div className="divide-y divide-border">
        {contestants.map((contestant) => (
          <div
            key={contestant.id}
            className="py-2.5 flex items-center gap-3 min-h-[56px]"
          >
            <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="font-bold truncate">{contestant.name}</p>
              {contestant.tribe && (
                <p className="text-xs text-muted-foreground">{contestant.tribe}</p>
              )}
            </div>
            <Select
              value={assignments[contestant.id] || "__unassigned__"}
              onValueChange={(v) => handleChange(contestant.id, v)}
            >
              <SelectTrigger className="w-[150px] sm:w-[180px]" aria-label={`Team for ${contestant.name}`}>
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {draftOrder.map((team) => (
                  <SelectItem
                    key={String(team)}
                    value={String(team)}
                    disabled={
                      teamCounts[team] >= picksPerTeam &&
                      assignments[contestant.id] !== String(team)
                    }
                  >
                    {team} ({teamCounts[team]}/{picksPerTeam})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <div className="flex sm:justify-end">
        <Button
          onClick={handleFinalize}
          disabled={!canFinalize || isSaving}
          variant="accent"
          size="lg"
          className="gap-2 w-full sm:w-auto"
        >
          {isSaving ? "Saving..." : "Save teams and start the game"}
          <ArrowRight className="h-5 w-5" />
        </Button>
      </div>
    </Card>
  );
};
