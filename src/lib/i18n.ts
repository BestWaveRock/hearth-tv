import { useCallback } from 'react';
import type { Language } from '../../shared/types';
import { useApp } from '../store/app';
import { strings, type Key } from './strings';

export type { Language };

/** The shape of the translation function returned by `useT()`. */
export type T = (key: Key, vars?: Record<string, string | number>) => string;

/**
 * Lightweight i18n, deliberately dependency-free.
 *
 * The dictionary lives in `strings.ts` and is keyed by a typed union, so a
 * typo in a key is a compile error rather than a silent blank label. A single
 * `useT()` hook subscribes to the current `settings.language` and returns a
 * `t()` function that interpolates `{placeholders}` with the values you pass.
 *
 * Server-generated messages (connection errors, health checks) are outside
 * this dictionary by design: they are produced by the Worker and arrive already
 * in English, so there is nothing to translate on the client.
 */

/**
 * Language detection lives in `./language` so the app store can use it without
 * importing this module, which would create a cycle. Re-exported here so callers
 * have a single obvious place to look.
 */
export { detectLanguage, isLanguage } from './language';

/** Reads the current UI language from the app store without re-rendering the world. */
export function useLanguage(): Language {
  return useApp((s) => s.settings.language);
}

/**
 * A translation function bound to the active language. Calling it re-renders
 * only when the language actually changes.
 */
export function useT(): (key: Key, vars?: Record<string, string | number>) => string {
  const lang = useLanguage();
  return useCallback(
    (key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );
}

export function translate(
  lang: Language,
  key: Key,
  vars?: Record<string, string | number>,
): string {
  const entry = strings[key];
  let text: string;
  if (!entry) {
    text = key;
  } else if (lang === 'zh') {
    text = entry.zh || entry.en;
  } else {
    text = entry.en;
  }
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value));
    }
  }
  return text;
}

/** Plural helpers that follow the language's grammar. */
export function plural(
  lang: Language,
  n: number,
  one: string,
  other: string,
  zh = '',
): string {
  if (lang === 'zh') return zh || `${n} ${other}`;
  return n === 1 ? one : other;
}
