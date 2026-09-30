import type { ReactNode } from "react";
import { toast as sonner } from "sonner";

type NotifyOptions = {
  title?: ReactNode;
  description?: ReactNode;
  variant?: "default" | "destructive";
  duration?: number;
};

/**
 * The app's one toast style (Sonner, restyled in components/ui/sonner.tsx). Takes the same
 * { title, description, variant } shape as the old shadcn toast so older screens could switch
 * over without rewriting every call.
 */
export function notify({ title, description, variant, duration }: NotifyOptions) {
  const show = variant === "destructive" ? sonner.error : sonner.success;
  show(title ?? "", { description, duration });
}

/** Drop-in for the old useToast() hook: `const { toast } = useNotify();` */
export const useNotify = () => ({ toast: notify });
