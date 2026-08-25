import type { Language } from '../../shared/types';

/**
 * Language detection, deliberately kept in its own module.
 *
 * `i18n.ts` imports the app store, and the store needs this function to pick its
 * initial language — importing it from `i18n.ts` would create a cycle. This file
 * depends on nothing but a type, so both sides can use it safely.
 */

const SUPPORTED: Language[] = ['en', 'zh'];

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED as string[]).includes(value);
}

/**
 * Picks a starting language from the browser.
 *
 * This matters because the pairing gate and the sign-in screen appear *before*
 * any account exists, so there is no stored preference to read yet. Greeting a
 * Chinese-speaking visitor in English — and making them hunt through an English
 * settings screen to fix it — would be a poor first impression.
 *
 * Once signed in, the account's saved `settings.language` always wins.
 */
export function detectLanguage(): Language {
  if (typeof navigator === 'undefined') return 'en';
  const tags = [navigator.language, ...(navigator.languages ?? [])];
  for (const tag of tags) {
    if (!tag) continue;
    const lower = tag.toLowerCase();
    // Covers zh, zh-CN, zh-Hans, zh-TW, zh-Hant and zh-HK.
    if (lower === 'zh' || lower.startsWith('zh-')) return 'zh';
  }
  return 'en';
}
