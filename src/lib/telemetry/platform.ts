/**
 * Coarse platform bucketing for telemetry. Deliberately approximate: the
 * goal is ~7 buckets with negligible entropy per guest, not accurate device
 * or browser detection. `detectPlatform` is a pure function of its inputs so
 * it can be tested without touching any global.
 */
import type { Platform } from './types.ts';

const IOS_DEVICE_RE = /iPad|iPhone|iPod/;
const IOS_OTHER_BROWSER_RE = /CriOS|FxiOS|EdgiOS|OPiOS/;
const ANDROID_OTHER_BROWSER_RE = /SamsungBrowser|OPR|EdgA|Firefox/;
const CHROMIUM_RE = /Chrome|Chromium/;

/**
 * Buckets a user agent string into a coarse platform.
 *
 * - iOS: the UA matches `iPad|iPhone|iPod`, OR the UA contains `Macintosh`
 *   and `maxTouchPoints > 1` — iPadOS 13+ requests desktop sites by default
 *   and reports as a touch-capable "Macintosh".
 *   - `ios-safari` unless the UA names a non-Safari iOS browser shell
 *     (`CriOS`, `FxiOS`, `EdgiOS`, `OPiOS`), in which case `ios-other`. All
 *     iOS browsers are WebKit under the hood, but only Safari gets the
 *     `ios-safari` label since that's the share-sheet behaviour of interest.
 * - Else Android: UA contains `Android`.
 *   - `android-chrome` if the UA contains `Chrome` and none of
 *     `SamsungBrowser`, `OPR`, `EdgA`, or `Firefox`; else `android-other`.
 * - Else desktop:
 *   - `desktop-chrome` if the UA contains `Chrome` or `Chromium` — this
 *     deliberately includes Edge and Opera, which share Chromium's engine
 *     and share behaviour.
 *   - `desktop-safari` if the UA contains `Safari` and not `Chrome`/`Chromium`.
 *   - otherwise `desktop-other`.
 */
export function detectPlatform(userAgent: string, maxTouchPoints: number): Platform {
  const isIos =
    IOS_DEVICE_RE.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1);
  if (isIos) {
    return IOS_OTHER_BROWSER_RE.test(userAgent) ? 'ios-other' : 'ios-safari';
  }

  if (userAgent.includes('Android')) {
    const isOtherBrowser = ANDROID_OTHER_BROWSER_RE.test(userAgent);
    return userAgent.includes('Chrome') && !isOtherBrowser ? 'android-chrome' : 'android-other';
  }

  if (CHROMIUM_RE.test(userAgent)) {
    return 'desktop-chrome';
  }
  if (userAgent.includes('Safari') && !CHROMIUM_RE.test(userAgent)) {
    return 'desktop-safari';
  }
  return 'desktop-other';
}

/**
 * Reads `navigator.userAgent`/`navigator.maxTouchPoints` and buckets them.
 *
 * Never throws. This is called at a telemetry call site as an *argument* to
 * `track()`, so it is evaluated before `track()`'s own try/catch can contain
 * it — a throw here would escape into the guest flow, which the telemetry
 * layer must never do. An unreadable navigator simply buckets as
 * `desktop-other`.
 */
export function currentPlatform(): Platform {
  try {
    const userAgent = typeof navigator.userAgent === 'string' ? navigator.userAgent : '';
    const maxTouchPoints =
      typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
    return detectPlatform(userAgent, maxTouchPoints);
  } catch {
    return 'desktop-other';
  }
}
