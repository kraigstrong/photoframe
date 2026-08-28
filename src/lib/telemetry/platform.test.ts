import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentPlatform, detectPlatform } from './platform.ts';
import type { Platform } from './types.ts';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1';

const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const SAMSUNG_INTERNET =
  'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/115.0.0.0 Mobile Safari/537.36';

const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0';

const MACOS_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

const MACOS_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0';

const WINDOWS_FIREFOX =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0';

const cases: Array<[string, string, number, Platform]> = [
  ['iPhone Safari', IPHONE_SAFARI, 5, 'ios-safari'],
  ['iPhone Chrome (CriOS)', IPHONE_CHROME, 5, 'ios-other'],
  ['iPad Safari', IPAD_SAFARI, 5, 'ios-safari'],
  ['iPadOS 13+ desktop-mode UA', IPAD_DESKTOP_MODE, 5, 'ios-safari'],
  ['Android Chrome', ANDROID_CHROME, 5, 'android-chrome'],
  ['Samsung Internet', SAMSUNG_INTERNET, 5, 'android-other'],
  ['Android Firefox', ANDROID_FIREFOX, 5, 'android-other'],
  ['macOS Safari', MACOS_SAFARI, 0, 'desktop-safari'],
  ['macOS Chrome', MACOS_CHROME, 0, 'desktop-chrome'],
  ['Windows Chrome', WINDOWS_CHROME, 0, 'desktop-chrome'],
  ['Windows Edge', WINDOWS_EDGE, 0, 'desktop-chrome'],
  ['Windows Firefox', WINDOWS_FIREFOX, 0, 'desktop-other'],
];

describe('detectPlatform', () => {
  it.each(cases)('%s -> %s', (_label, userAgent, maxTouchPoints, expected) => {
    expect(detectPlatform(userAgent, maxTouchPoints)).toBe(expected);
  });

  it('treats a Macintosh UA with maxTouchPoints <= 1 as a real Mac, not an iPad', () => {
    expect(detectPlatform(MACOS_SAFARI, 1)).toBe('desktop-safari');
    expect(detectPlatform(MACOS_SAFARI, 0)).toBe('desktop-safari');
  });
});

describe('currentPlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('buckets from the live navigator', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    });
    expect(currentPlatform()).toBe('ios-safari');
  });

  it('defaults maxTouchPoints to 0 when the navigator does not report it', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(currentPlatform()).not.toBe('ios-safari');
  });

  // Contract: currentPlatform() is evaluated as an argument to track(), so it
  // sits OUTSIDE track()'s try/catch. A throw here would reach the guest flow.
  it('never throws when navigator is unreadable', () => {
    vi.stubGlobal('navigator', {
      get userAgent(): string {
        throw new Error('navigator unavailable');
      },
    });
    expect(() => currentPlatform()).not.toThrow();
    expect(currentPlatform()).toBe('desktop-other');
  });

  it('never throws when navigator is missing entirely', () => {
    vi.stubGlobal('navigator', undefined);
    expect(() => currentPlatform()).not.toThrow();
  });
});
