import { useState } from "react";
import { useBugNotifications } from "@/hooks/useBugNotifications";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MessageCircle, X } from "lucide-react";

export function BugResponseBanner() {
  const { user } = useAuth();
  const { unreadResponses, markAsViewed } = useBugNotifications(user?.id);
  const [dismissed, setDismissed] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  if (dismissed || !unreadResponses.length) return null;

  const handleView = () => setViewOpen(true);

  const handleDismiss = () => {
    markAsViewed(unreadResponses.map((r) => r.id));
    setDismissed(true);
    setViewOpen(false);
  };

  return (
    <>
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] sm:w-auto sm:max-w-lg animate-in slide-in-from-top-2 fade-in duration-300">
        <div className="bg-header flex items-center gap-3 rounded-[14px] border-2 border-b-4 border-plank py-2 pl-4 pr-2 shadow-md">
          <MessageCircle className="h-4 w-4 shrink-0 text-header-label" aria-hidden="true" />
          <span className="flex-1 text-sm font-bold">
            You have {unreadResponses.length === 1 ? "a response" : `${unreadResponses.length} responses`} to your bug report{unreadResponses.length > 1 ? "s" : ""}!
          </span>
          <Button
            variant="accent"
            size="sm"
            className="shrink-0"
            onClick={handleView}
          >
            View
          </Button>
          <button
            onClick={handleDismiss}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-header-label transition-colors hover:text-[hsl(var(--header-fg))]"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bug report updates</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {unreadResponses.map((r) => (
              <div key={r.id} className="glass rounded-[12px] space-y-1.5 p-3">
                <p className="text-xs text-muted-foreground line-clamp-2">
                  Your report: "{r.description}"
                </p>
                <p className="text-sm">{r.admin_notes}</p>
                <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-foreground capitalize">
                  {r.status.replace("_", " ")}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={handleDismiss} className="w-full">Got it, thanks!</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
