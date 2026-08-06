/**
 * Platform detection, for showing the shortcut the user's keyboard actually has.
 *
 * `navigator.platform` is deprecated but still the only thing every browser
 * agrees on, so it is the fallback behind `userAgentData`. Getting this wrong
 * is not cosmetic: telling a Mac user to press Ctrl+K sends them to a key that
 * does nothing.
 */
function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;

  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (data?.platform) return /mac/i.test(data.platform);

  // iPadOS reports as "MacIntel", which is correct for our purposes — an
  // attached keyboard there uses Command too.
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

export const IS_MAC = detectMac();

/** The modifier key symbol/name to print in shortcut hints. */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

/** Screen-reader wording — "⌘" alone is announced as "at" or skipped entirely. */
export const MOD_KEY_LABEL = IS_MAC ? 'Command' : 'Control';
