import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug } from "lucide-react";
import { BugReportDialog } from "@/components/BugReportDialog";
import { DonateButton } from "@/components/DonateButton";
import { useIsMobile } from "@/hooks/use-mobile";

export function AppFooter() {
  const [bugOpen, setBugOpen] = useState(false);
  const location = useLocation();
  const leagueMatch = location.pathname.match(/^\/league\/([a-f0-9-]+)/i);
  const leagueId = leagueMatch?.[1];
  const isMobile = useIsMobile();

  return (
    <>
      <footer className="mt-16 border-t-2 border-plank bg-card px-4 py-4">
        <div className="container mx-auto flex flex-col items-center gap-2">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setBugOpen(true)}
              className="flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Bug className="h-3 w-3" />
              Report a bug
            </button>
            <span className="text-border">|</span>
            <DonateButton />
          </div>
          <p className="text-center text-[11px] leading-tight text-muted-foreground">
            Survivors Ready is a free fan game. Not affiliated with CBS or the show.
          </p>
        </div>
      </footer>
      {/* On phones the league page has a fixed bottom tab bar; keep the footer clear of it */}
      {leagueId && isMobile && <div aria-hidden="true" className="h-[calc(4.5rem+env(safe-area-inset-bottom))]" />}
      <BugReportDialog open={bugOpen} onOpenChange={setBugOpen} leagueId={leagueId} />
    </>
  );
}
