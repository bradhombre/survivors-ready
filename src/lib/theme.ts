import { useEffect, useState } from "react";

/**
 * Light / dark appearance. Dark is the default for everyone; people can pick Light or
 * "Match my phone" in the footer. The choice is remembered on this device.
 * index.html runs the same check before the page draws, so there's no flash of the wrong theme.
 */
export type ThemeChoice = "dark" | "light" | "system";

const KEY = "sr-theme";
const EVENT = "sr-theme-change";
const META_COLOR = { dark: "#132419", light: "#1D3326" };

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light" || v === "system") return v;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return "dark";
}

const phoneIsDark = () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolvesToDark(choice: ThemeChoice): boolean {
  return choice === "dark" || (choice === "system" && phoneIsDark());
}

export function applyTheme(choice: ThemeChoice) {
  const dark = resolvesToDark(choice);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", dark ? META_COLOR.dark : META_COLOR.light);
  });
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    /* not remembered, but still applied for this visit */
  }
  applyTheme(choice);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }));
}

/** Current choice plus whether it's showing dark right now; follows the phone live when "system". */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(getThemeChoice);
  const [dark, setDark] = useState(() => resolvesToDark(getThemeChoice()));

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ThemeChoice>).detail;
      setChoice(next);
      setDark(resolvesToDark(next));
    };
    window.addEventListener(EVENT, onChange);
    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onPhone = () => {
      const current = getThemeChoice();
      if (current === "system") {
        applyTheme("system");
        setDark(resolvesToDark("system"));
      }
    };
    mql?.addEventListener?.("change", onPhone);
    return () => {
      window.removeEventListener(EVENT, onChange);
      mql?.removeEventListener?.("change", onPhone);
    };
  }, []);

  return { choice, dark, setChoice: setThemeChoice };
}
