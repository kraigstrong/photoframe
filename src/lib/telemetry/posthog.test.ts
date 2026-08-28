import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostHogConfig } from 'posthog-js';

const POSTHOG_KEY = 'phc_test_key';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? (data.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

/** Flushes the microtask/macrotask queue so the single `await import(...)`
 * inside `loadPostHog` (see posthog.ts) has a chance to settle. */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const initMock = vi.fn();
const registerMock = vi.fn();
const instanceCaptureMock = vi.fn();
const fakePosthogInstance = {
  init: initMock,
  register: registerMock,
  capture: instanceCaptureMock,
};

function mockSuccessfulLoad(): void {
  vi.doMock('posthog-js', () => ({ default: fakePosthogInstance }));
}

describe('posthog transport', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.resetModules();
    initMock.mockReset();
    registerMock.mockReset();
    instanceCaptureMock.mockReset();
    mockSuccessfulLoad();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.doUnmock('posthog-js');
  });

  describe('gating', () => {
    it('never loads or initializes posthog-js when no key is configured', async () => {
      const { capture } = await import('./posthog.ts');
      capture('app_open', { v: 1 });
      await flushAsync();

      expect(initMock).not.toHaveBeenCalled();
      expect(instanceCaptureMock).not.toHaveBeenCalled();
    });
  });

  describe('lockdown config', () => {
    it('passes the load-bearing privacy flags to posthog.init', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

      const { capture } = await import('./posthog.ts');
      capture('app_open', { v: 1 });
      await flushAsync();

      expect(initMock).toHaveBeenCalledTimes(1);
      const [key, config] = initMock.mock.calls[0] as [string, Partial<PostHogConfig>];
      expect(key).toBe(POSTHOG_KEY);

      expect(config.autocapture).toBe(false);
      expect(config.capture_pageview).toBe(false);
      expect(config.capture_pageleave).toBe(false);
      expect(config.disable_session_recording).toBe(true);
      expect(config.disable_surveys).toBe(true);
      expect(config.capture_heatmaps).toBe(false);
      expect(config.persistence).toBe('localStorage');
      expect(config.person_profiles).toBe('never');
      expect(Array.isArray(config.property_denylist)).toBe(true);
      expect(config.property_denylist?.length).toBeGreaterThan(0);
      expect(config.property_denylist).toEqual(
        expect.arrayContaining(['$ip', '$current_url', '$raw_user_agent', '$screen_width']),
      );
      expect(typeof config.before_send).toBe('function');
      expect(config.bootstrap?.distinctID?.length).toBeGreaterThan(0);
    });

    it('registers $geoip_disable as a super property once loaded', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

      const { capture } = await import('./posthog.ts');
      capture('app_open', { v: 1 });
      await flushAsync();

      expect(registerMock).toHaveBeenCalledWith({ $geoip_disable: true });
    });
  });

  describe('sanitizeProperties', () => {
    it('strips every disallowed property, including IP/URL/screen/UA and unknown extras', async () => {
      const { sanitizeProperties } = await import('./posthog.ts');

      const dirty = {
        $ip: '203.0.113.5',
        $current_url: 'https://example.com/edit?x=1',
        $screen_width: 1170,
        $raw_user_agent: 'Mozilla/5.0 (iPhone...)',
        filename: 'IMG_1234.HEIC',
      };

      const clean = sanitizeProperties(dirty);

      // $ip is the one property that is not merely dropped: it is
      // overwritten with a dummy, because PostHog reads the real address
      // from the forwarded request header when properties carry none.
      expect(clean).toEqual({ $ip: '0.0.0.0' });
      expect(clean.$ip).not.toBe('203.0.113.5');
      expect('$current_url' in clean).toBe(false);
      expect('$screen_width' in clean).toBe(false);
      expect('$raw_user_agent' in clean).toBe(false);
      expect('filename' in clean).toBe(false);
    });

    it('keeps allowlisted event fields and the minimal $-prefixed properties', async () => {
      const { sanitizeProperties } = await import('./posthog.ts');

      const mixed = {
        ev: 'frame_select',
        frame: 'panther-prowl',
        did: 'device-1',
        $lib: 'web',
        $lib_version: '1.422.4',
        $insert_id: 'abc123',
        $time: 1234567890,
        $geoip_disable: true,
        $current_url: 'https://example.com',
      };

      const clean = sanitizeProperties(mixed);

      expect(clean).toEqual({
        ev: 'frame_select',
        frame: 'panther-prowl',
        did: 'device-1',
        $lib: 'web',
        $lib_version: '1.422.4',
        $insert_id: 'abc123',
        $time: 1234567890,
        $geoip_disable: true,
        $ip: '0.0.0.0',
      });
    });
  });

  describe('queueing', () => {
    it('queues events captured before load and drains them in order once posthog-js loads', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

      const { capture } = await import('./posthog.ts');
      // All three happen synchronously, before the dynamic import can
      // possibly have resolved.
      capture('app_open', { seq: 1 });
      capture('source_click', { seq: 2 });
      capture('photo_load', { seq: 3 });

      expect(instanceCaptureMock).not.toHaveBeenCalled();

      await flushAsync();

      expect(instanceCaptureMock).toHaveBeenCalledTimes(3);
      expect(instanceCaptureMock.mock.calls.map((c) => c[0])).toEqual([
        'app_open',
        'source_click',
        'photo_load',
      ]);
    });

    it('forwards directly (no queueing) once the library has already loaded', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

      const { capture } = await import('./posthog.ts');
      capture('app_open', { seq: 1 });
      await flushAsync();
      instanceCaptureMock.mockClear();

      capture('frame_select', { seq: 2 });

      expect(instanceCaptureMock).toHaveBeenCalledTimes(1);
      expect(instanceCaptureMock).toHaveBeenCalledWith('frame_select', { seq: 2 });
    });
  });

  describe('a failed dynamic import', () => {
    it('does not throw, drops the queue, and stays silent for the rest of the session', async () => {
      vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);
      vi.doMock('posthog-js', () => {
        throw new Error('network down');
      });

      const { capture } = await import('./posthog.ts');
      expect(() => capture('app_open', { seq: 1 })).not.toThrow();

      await flushAsync();

      // Restore a working mock and confirm capture() still never reaches it
      // — a failed load must never be retried.
      vi.doMock('posthog-js', () => ({ default: fakePosthogInstance }));
      expect(() => capture('source_click', { seq: 2 })).not.toThrow();
      await flushAsync();

      expect(initMock).not.toHaveBeenCalled();
      expect(instanceCaptureMock).not.toHaveBeenCalled();
    });
  });
});
