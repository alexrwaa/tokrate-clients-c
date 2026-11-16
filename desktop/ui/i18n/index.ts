import { useSyncExternalStore } from "react";
import { enUS } from "./en-US";
import { zhCN } from "./zh-CN";

/**
 * Tiny two-language store, no framework. English is the authoritative dictionary: a key that the
 * Chinese dictionary lacks falls back to English (and warns in development), so a missed
 * translation can never blank out the UI.
 */
export type Language = "zh-CN" | "en-US";

export type Vars = Record<string, string | number>;

/** The portable build ships Chinese by default. */
export const DEFAULT_LANGUAGE: Language = "zh-CN";

/**
 * The preference lives in localStorage, which WebView2 keeps inside the app's user-data folder
 * (`data/webview/` in the portable directory). That is why moving the portable folder keeps the
 * chosen language: the profile moves with it.
 */
export const LANGUAGE_STORAGE_KEY = "tokrate-cn.language";

const DICTIONARIES: Record<Language, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

const isLanguage = (value: unknown): value is Language =>
  value === "zh-CN" || value === "en-US";

/** localStorage can be missing (tests, opaque origins) or read-only; never throw. */
function readStoredLanguage(): Language {
  try {
    if (typeof window === "undefined" || !window.localStorage) return DEFAULT_LANGUAGE;
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // A read-only profile keeps the default.
  }
  return DEFAULT_LANGUAGE;
}

let current: Language = readStoredLanguage();

const listeners = new Set<() => void>();

function syncDocumentLanguage(language: Language) {
  try {
    if (typeof document !== "undefined") document.documentElement.lang = language;
  } catch {
    // No document (tests, server render): nothing to sync.
  }
}

function persistLanguage(language: Language) {
  try {
    if (typeof window !== "undefined" && window.localStorage)
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The WebView profile may be read-only; the language still applies for this session.
  }
}

// Reflect the stored preference on first load (when there is a document).
syncDocumentLanguage(current);

export const getLanguage = (): Language => current;

/** Applies immediately to every mounted component and is remembered for the next launch. */
export function setLanguage(language: Language): void {
  if (!isLanguage(language) || language === current) return;
  current = language;
  persistLanguage(language);
  syncDocumentLanguage(language);
  listeners.forEach((listener) => listener());
}

function interpolate(template: string, vars: Vars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/** Translate a flat key ("settings.title") with optional `{name}` interpolation. */
export function t(key: string, vars?: Vars): string {
  const dictionary = DICTIONARIES[current];
  let template = dictionary[key];
  if (template === undefined) {
    template = enUS[key];
    if (template === undefined) {
      if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
      return key;
    }
    if (current !== "en-US" && import.meta.env?.DEV)
      console.warn(`[i18n] falling back to English for: ${key}`);
  }
  return interpolate(template, vars);
}

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The language plus `t`, subscribing to changes: a switch re-renders every caller right away,
 * without a reload.
 */
export function useI18n(): {
  language: Language;
  t: typeof t;
  setLanguage: typeof setLanguage;
} {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { language, t, setLanguage };
}

/** Exposed for the key-completeness test. */
export const dictionaries = DICTIONARIES;
