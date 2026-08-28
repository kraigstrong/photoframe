import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const POSTHOG_KEY = 'phc_test_key';

/**
 * A minimal in-memory `Storage` stand-in, stubbed in for `localStorage`/
 * `sessionStorage` so each test gets a clean slate regardless of the host
 * Node version's real Web Storage support (see ids.test.ts for the same
 * helper and the reasoning). `track()` only reads these indirectly via
 * ids.ts, so these tests just need seq to start from a known value.
 */
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

/**
 * `track.ts` only depends on `posthog.ts` through its exported `capture()`
 * function (see the module's own JSDoc: "the actual transport... lives in
 * posthog.ts"). Mocking that seam, rather than `posthog-js` itself, keeps
 * these tests focused on what `track.ts` is actually responsible for: the
 * allowlist and envelope logic. `posthog.ts`'s own lazy-load/queue/lockdown
 * behavior is covered separately in posthog.test.ts.
 */
const captureMock = vi.fn();
vi.mock('./posthog.ts', () => ({ capture: captureMock }));

describe('track', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.resetModules();
    captureMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The most important test in this file: with no key configured, track()
  // must be a complete no-op — not just "doesn't send," but doesn't touch
  // ids.ts either (no device/session id minted, no seq incremented).
  it('never calls capture() when no PostHog key is configured', async () => {
    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(captureMock).not.toHaveBeenCalled();
  });

  it('calls capture() with the event name and the configured key present', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(captureMock).toHaveBeenCalledTimes(1);
    const [name] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('source_click');
  });

  it('passes exactly the expected key set as properties, including v, did, sid, seq', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const { track } = await import('./track.ts');
    track({ ev: 'frame_select', frame: 'panther-prowl' });

    const [, properties] = captureMock.mock.calls[0] as [string, Record<string, unknown>];

    expect(Object.keys(properties).toSorted()).toEqual(['did', 'ev', 'frame', 'seq', 'sid', 'v']);
    expect(properties.v).toBe(1);
    expect(typeof properties.did).toBe('string');
    expect(typeof properties.sid).toBe('string');
    expect(properties.seq).toBe(1);
    expect(properties.ev).toBe('frame_select');
    expect(properties.frame).toBe('panther-prowl');
  });

  // Regression net for the module's whole reason to exist. TypeScript only
  // excess-property-checks object *literals*, so an event assembled in a
  // variable can carry extra fields, satisfy TelemetryEvent, and compile
  // cleanly. track() must drop them rather than forward them.
  it('drops properties the caller attached that are not on the allowlist', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const smuggled = {
      ev: 'photo_load' as const,
      source: 'camera' as const,
      ok: true,
      // None of these may ever reach the wire.
      filename: 'IMG_1234.HEIC',
      width: 4032,
      height: 3024,
      dataUrl: 'data:image/jpeg;base64,AAAA',
    };

    const { track } = await import('./track.ts');
    track(smuggled);

    const [, properties] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
    const text = JSON.stringify(properties);

    expect(Object.keys(properties).toSorted()).toEqual([
      'did',
      'ev',
      'ok',
      'seq',
      'sid',
      'source',
      'v',
    ]);
    expect(text).not.toContain('IMG_1234');
    expect(text).not.toContain('4032');
    expect(text).not.toContain('data:image');
  });

  it('omits an absent optional field rather than passing it as null', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const { track } = await import('./track.ts');
    track({ ev: 'export_result', via: 'share', outcome: 'shared', frame: 'design-1' });

    const [, properties] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
    expect('err' in properties).toBe(false);
  });

  it('carries err when present', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const { track } = await import('./track.ts');
    track({
      ev: 'export_result',
      via: 'share',
      outcome: 'failed',
      frame: 'design-1',
      err: 'NotAllowedError',
    });

    const [, properties] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties.err).toBe('NotAllowedError');
  });

  it('envelope fields cannot be shadowed by a caller-supplied value', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const spoofed = {
      ev: 'source_click' as const,
      source: 'camera' as const,
      v: 999,
      did: 'spoofed-device',
      sid: 'spoofed-session',
      seq: 12345,
    };

    const { track } = await import('./track.ts');
    track(spoofed);

    const [, properties] = captureMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(properties.v).toBe(1);
    expect(properties.did).not.toBe('spoofed-device');
    expect(properties.sid).not.toBe('spoofed-session');
    expect(properties.seq).toBe(1);
  });

  it('increments seq across successive track() calls', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });
    track({ ev: 'source_click', source: 'library' });

    const first = (captureMock.mock.calls[0] as [string, Record<string, unknown>])[1];
    const second = (captureMock.mock.calls[1] as [string, Record<string, unknown>])[1];
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('does not throw when capture() itself throws', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', POSTHOG_KEY);
    captureMock.mockImplementation(() => {
      throw new Error('capture broke');
    });

    const { track } = await import('./track.ts');
    expect(() => track({ ev: 'source_click', source: 'camera' })).not.toThrow();
  });
});
