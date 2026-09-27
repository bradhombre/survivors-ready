import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Vote, Merge, Flame, X, Lightbulb } from "lucide-react";

interface GameplayTipsProps {
  leagueId: string;
}

const TIPS = [
  {
    icon: Trophy,
    title: "Leaderboard",
    description:
      "Your team earns points when your contestants do things in the show — find idols, win immunity, survive rounds, and more.",
  },
  {
    icon: Vote,
    title: "Final tribal vote",
    description:
      "Near the end of each episode, predict who gets voted out. Correct guesses earn bonus points — unless everyone picks the same person!",
  },
  {
    icon: Merge,
    title: "Post-merge boost",
    description:
      "Once the merge happens, your commissioner toggles Post-Merge on, which increases survival points per round.",
  },
  {
    icon: Flame,
    title: "Scoring events",
    description:
      'Commissioners or players tap a contestant to score actions like "Find Idol", "Win Immunity", "Cry", and more during each episode.',
  },
];

export function GameplayTips({ leagueId }: GameplayTipsProps) {
  const storageKey = `game-tips-seen-${leagueId}`;
  const [dismissed, setDismissed] = useState(() => {
    return localStorage.getItem(storageKey) === "true";
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
      <Card>
        <CardHeader className="p-5 pb-3 flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <p className="label-caps flex items-center gap-1.5 text-muted-foreground">
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              Tips
            </p>
            <CardTitle>How the game works</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="-mr-2 -mt-2 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss tips"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TIPS.map((tip) => {
              const Icon = tip.icon;
              return (
                <div key={tip.title} className="glass rounded-[12px] flex items-start gap-3 p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{tip.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{tip.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={handleDismiss}>
              Got it
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
