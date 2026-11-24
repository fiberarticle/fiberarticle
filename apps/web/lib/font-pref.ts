/*
 * Interface font choice (Settings > Preferences). Stored in the browser like
 * the light/dark theme, and applied as data-font on <html>; globals.css maps
 * that attribute to the --app-font stack. Google Sans is the default, so it
 * is stored as "no attribute".
 */

export const FONT_STORAGE_KEY = "fa-font";

export type InterfaceFont = "google-sans" | "bricolage";

export const FONT_OPTIONS: {
  value: InterfaceFont;
  label: string;
  /** CSS font-family used to preview the option in its own face. */
  preview: string;
}[] = [
  {
    value: "google-sans",
    label: "Google Sans",
    preview: '"Google Sans", ui-sans-serif, system-ui, sans-serif',
  },
  {
    value: "bricolage",
    label: "Bricolage Grotesque",
    preview: "var(--font-bricolage), ui-sans-serif, system-ui, sans-serif",
  },
];

export const DEFAULT_FONT: InterfaceFont = "google-sans";

function isFont(value: string | null): value is InterfaceFont {
  return FONT_OPTIONS.some((o) => o.value === value);
}

export function readFont(): InterfaceFont {
  try {
    const stored = localStorage.getItem(FONT_STORAGE_KEY);
    return isFont(stored) ? stored : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

export function applyFont(font: InterfaceFont) {
  const root = document.documentElement;
  if (font === DEFAULT_FONT) delete root.dataset.font;
  else root.dataset.font = font;
  try {
    localStorage.setItem(FONT_STORAGE_KEY, font);
  } catch {
    // Private mode or storage blocked: the choice lasts for this page only.
  }
}

/**
 * Runs in <head> before the first paint, so a saved Bricolage choice never
 * flashes Google Sans first. Kept tiny and dependency free.
 */
export const FONT_INIT_SCRIPT = `try{var f=localStorage.getItem("${FONT_STORAGE_KEY}");if(f&&f!=="${DEFAULT_FONT}")document.documentElement.dataset.font=f}catch(e){}`;
