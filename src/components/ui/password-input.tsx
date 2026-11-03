import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<"input">, "type">;

/** Password box with an eye button to show or hide what's typed. Each box toggles on its own. */
const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(({ className, disabled, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);
  const label = visible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        className={cn("pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        disabled={disabled}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
