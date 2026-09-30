import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  title: string;
  description?: string;
  /** Label for the yes button (default "Continue") */
  confirmText?: string;
  cancelText?: string;
  /** Red yes button, for things that remove or reset */
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let enqueue: ((p: Pending) => void) | null = null;

/**
 * The app's yes/no popup, styled like every other dialog (instead of the browser's own
 * confirm box). `if (!(await confirmDialog({ title: "…" }))) return;`
 * Falls back to the browser's box if the host isn't mounted.
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const o = typeof options === "string" ? { title: options } : options;
  if (!enqueue) return Promise.resolve(window.confirm([o.title, o.description].filter(Boolean).join("\n\n")));
  const add = enqueue;
  return new Promise((resolve) => add({ ...o, resolve }));
}

/** Mount once (App.tsx). Shows one confirm at a time, in order. */
export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);

  useEffect(() => {
    enqueue = (p) => setQueue((q) => [...q, p]);
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];
  const answer = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  return (
    <AlertDialog
      open={!!current}
      onOpenChange={(open) => {
        // Cancel, Escape or tapping outside
        if (!open) answer(false);
      }}
    >
      {current && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{current.title}</AlertDialogTitle>
            {current.description && (
              <AlertDialogDescription className="whitespace-pre-line">{current.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-11">{current.cancelText || "Cancel"}</AlertDialogCancel>
            <Button
              className="h-11"
              variant={current.destructive ? "destructive" : "accent"}
              onClick={() => answer(true)}
            >
              {current.confirmText || "Continue"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
