import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface TourStep {
  target: string; // data-tour attribute value
  title: string;
  description: string;
}

interface OnboardingTourProps {
  leagueId: string;
  isLeagueAdmin: boolean;
  isSuperAdmin?: boolean;
}

const PLAYER_STEPS: TourStep[] = [
  {
    target: "play",
    title: "Play tab",
    description:
      "This is where your fantasy game lives. During the draft, you'll pick Survivor contestants for your team. Once the game starts, your commissioner scores events each episode.",
  },
  {
    target: "league",
    title: "League tab",
    description:
      "See who's in your league, customize your team name and avatar, and share the invite code with friends.",
  },
  {
    target: "chat",
    title: "League chat",
    description:
      "Chat with your league mates and ask @jeffbot any Survivor question — trivia, strategy, history.",
  },
];

const ADMIN_STEP: TourStep = {
  target: "admin",
  title: "Admin tab",
  description:
    "Manage your cast, scoring settings, and league configuration. You'll use this to score events during each episode.",
};

export function OnboardingTour({ leagueId, isLeagueAdmin, isSuperAdmin }: OnboardingTourProps) {
  const storageKey = `tour-seen-${leagueId}`;
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>();

  const steps: TourStep[] = [
    ...PLAYER_STEPS,
    ...(isLeagueAdmin ? [ADMIN_STEP] : []),
  ];

  // Auto-start after delay if not seen (skip for super admins)
  useEffect(() => {
    if (isSuperAdmin) return;
    if (localStorage.getItem(storageKey) === "true") return;
    const timer = setTimeout(() => setActive(true), 800);
    return () => clearTimeout(timer);
  }, [storageKey, isSuperAdmin]);

  const positionPopover = useCallback(() => {
    if (!active) return;
    const step = steps[stepIndex];
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    if (el) {
      setRect(el.getBoundingClientRect());
    }
    rafRef.current = requestAnimationFrame(positionPopover);
  }, [active, stepIndex, steps]);

  useEffect(() => {
    if (active) {
      rafRef.current = requestAnimationFrame(positionPopover);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, positionPopover]);

  const finish = useCallback(() => {
    localStorage.setItem(storageKey, "true");
    setActive(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [storageKey]);

  const next = () => {
    if (stepIndex < steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      finish();
    }
  };

  const back = () => {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  };

  if (!active || !rect) return null;

  const step = steps[stepIndex];
  const padding = 6;

  // Position popover below the target, or above it when the target sits in the
  // lower half of the viewport (e.g. a bottom tab bar on phones). Clamp inside
  // the viewport with 16px margins.
  const margin = 16;
  const gap = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const popoverWidth = Math.min(300, viewportW - margin * 2);
  const placeAbove = rect.top + rect.height / 2 > viewportH / 2;
  const popoverLeft = Math.max(margin, Math.min(rect.left, viewportW - popoverWidth - margin));
  const popoverTop = Math.max(margin, rect.bottom + gap);
  const popoverBottom = Math.max(margin, viewportH - rect.top + gap);
  const popoverMaxHeight = Math.max(
    120,
    placeAbove ? viewportH - popoverBottom - margin : viewportH - popoverTop - margin
  );

  return createPortal(
    <div className="fixed inset-0 z-[100]" onClick={finish}>
      {/* Backdrop with cutout using clip-path */}
      <div
        className="absolute inset-0 bg-black/60 transition-all duration-300"
        style={{
          clipPath: `polygon(
            0% 0%, 0% 100%, 
            ${rect.left - padding}px 100%, 
            ${rect.left - padding}px ${rect.top - padding}px, 
            ${rect.right + padding}px ${rect.top - padding}px, 
            ${rect.right + padding}px ${rect.bottom + padding}px, 
            ${rect.left - padding}px ${rect.bottom + padding}px, 
            ${rect.left - padding}px 100%, 
            100% 100%, 100% 0%
          )`,
        }}
      />

      {/* Highlight ring */}
      <div
        className="absolute rounded-[14px] ring-[3px] ring-accent ring-offset-2 ring-offset-transparent pointer-events-none transition-all duration-300"
        style={{
          top: rect.top - padding,
          left: rect.left - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
      />

      {/* Popover */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="plank absolute overflow-y-auto p-4 shadow-md transition-all duration-300 animate-in fade-in-0 zoom-in-95"
        style={{
          width: popoverWidth,
          left: popoverLeft,
          maxHeight: popoverMaxHeight,
          ...(placeAbove ? { bottom: popoverBottom } : { top: popoverTop }),
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 space-y-1.5">
            <p className="label-caps text-muted-foreground tabular">
              Step {stepIndex + 1} of {steps.length}
            </p>
            <h3 className="font-display text-2xl leading-none">{step.title}</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={finish}
            className="h-10 w-10 shrink-0 -mt-2 -mr-2 text-muted-foreground"
            aria-label="Close tour"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">{step.description}</p>
        <div className="flex items-center justify-end gap-2">
          {stepIndex > 0 && (
            <Button variant="ghost" onClick={back}>
              Back
            </Button>
          )}
          <Button variant="accent" onClick={next}>
            {stepIndex === steps.length - 1 ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
