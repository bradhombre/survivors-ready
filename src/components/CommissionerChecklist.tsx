import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, PartyPopper, Users, Sliders, Play, UserPlus } from "lucide-react";

type ViewMode = "draft" | "game" | "history" | "league" | "admin";

interface CommissionerChecklistProps {
  leagueId: string;
  contestantCount: number;
  filledTeamCount: number;
  mode: string;
  onNavigate: (view: ViewMode) => void;
}

const STEPS = [
  {
    id: "cast",
    label: "Add your cast",
    description: "Add the Survivor contestants for this season",
    icon: Users,
    target: "admin" as ViewMode,
  },
  {
    id: "invite",
    label: "Invite players",
    description: "Share your league invite code with friends",
    icon: UserPlus,
    target: "league" as ViewMode,
  },
  {
    id: "scoring",
    label: "Customize scoring",
    description: "Tweak point values to your liking (optional)",
    icon: Sliders,
    target: "admin" as ViewMode,
  },
  {
    id: "draft",
    label: "Start the draft",
    description: "Kick off the draft once everyone's ready",
    icon: Play,
    target: "admin" as ViewMode,
  },
];

export function CommissionerChecklist({
  leagueId,
  contestantCount,
  filledTeamCount,
  mode,
  onNavigate,
}: CommissionerChecklistProps) {
  const storageKey = `checklist-dismissed-${leagueId}`;
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(storageKey) === "true";
  });

  // Auto-dismiss when game starts
  useEffect(() => {
    if (mode === "game" && !dismissed) {
      localStorage.setItem(storageKey, "true");
      setDismissed(true);
    }
  }, [mode, dismissed, storageKey]);

  if (dismissed) return null;

  const completionMap: Record<string, boolean> = {
    cast: contestantCount > 0,
    invite: filledTeamCount > 1,
    scoring: false, // always shown as actionable (optional step)
    draft: mode !== "setup",
  };

  const completedCount = Object.values(completionMap).filter(Boolean).length;
  const allDone = completedCount >= 3; // scoring is optional, so 3/4 is effectively "done"

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <Card className="mx-4 mt-4 max-w-7xl lg:mx-auto">
      <CardHeader className="p-5 pb-3 flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <CardTitle>
            {allDone ? "You're all set!" : "Get your league ready"}
          </CardTitle>
          <Badge variant="outline" className="tabular">
            {completedCount}/4 done
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDismiss}
          className="-mr-2 -mt-2 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss checklist"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        {allDone ? (
          <div className="glass rounded-[12px] flex flex-wrap items-center gap-3 px-4 py-3">
            <PartyPopper className="h-5 w-5 text-success shrink-0" aria-hidden="true" />
            <p className="text-sm text-muted-foreground flex-1 min-w-[12rem]">
              Your league is set up and ready to play. Have fun!
            </p>
            <Button variant="outline" onClick={handleDismiss} className="ml-auto shrink-0">
              Dismiss
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {STEPS.map((step) => {
              const done = completionMap[step.id];
              const Icon = step.icon;
              return (
                <button
                  key={step.id}
                  onClick={() => onNavigate(step.target)}
                  className={`flex min-h-[44px] items-center gap-3 rounded-[12px] border-[1.5px] bg-card p-3 text-left transition-colors ${
                    done
                      ? "border-border"
                      : step.id === "scoring"
                        ? "border-dashed border-input hover:bg-muted"
                        : "border-border hover:bg-muted hover:border-plank"
                  }`}
                >
                  {done ? (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                      <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                    </span>
                  ) : (
                    <span className="h-7 w-7 shrink-0 rounded-full border-2 border-input" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Icon className={`h-3.5 w-3.5 ${done ? "text-success" : "text-muted-foreground"}`} aria-hidden="true" />
                      <span className={`text-sm font-bold ${done ? "line-through text-muted-foreground" : ""}`}>
                        {step.label}
                      </span>
                      {step.id === "scoring" && !done && (
                        <Badge variant="outline" className="border-[1.5px] border-input px-2 py-0 text-[11px] text-muted-foreground">Optional</Badge>
                      )}
                    </div>
                    <p className={`text-xs mt-0.5 ${done ? "font-bold text-success" : "text-muted-foreground"}`}>
                      {done ? "Done" : step.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
