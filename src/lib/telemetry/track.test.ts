import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENDPOINT = 'https://x.test/api/e';

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

describe('track', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('sessionStorage', createMemoryStorage());
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never calls sendBeacon or fetch when no endpoint is configured', async () => {
    const beaconSpy = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(beaconSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls sendBeacon once with the configured endpoint and a Blob', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(beaconSpy).toHaveBeenCalledTimes(1);
    const [url, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    expect(url).toBe(ENDPOINT);
    expect(payload).toBeInstanceOf(Blob);
  });

  it('serializes exactly the expected key set, including v, did, sid, seq', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    track({ ev: 'frame_select', frame: 'panther-prowl' });

    const [, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    const body = JSON.parse(await payload.text()) as Record<string, unknown>;

    expect(Object.keys(body).toSorted()).toEqual(['did', 'ev', 'frame', 'seq', 'sid', 'v']);
    expect(body.v).toBe(1);
    expect(typeof body.did).toBe('string');
    expect(typeof body.sid).toBe('string');
    expect(body.seq).toBe(1);
    expect(body.ev).toBe('frame_select');
    expect(body.frame).toBe('panther-prowl');
  });

  // Regression net for the module's whole reason to exist. TypeScript only
  // excess-property-checks object *literals*, so an event assembled in a
  // variable can carry extra fields, satisfy TelemetryEvent, and compile
  // cleanly. track() must drop them rather than serialize them.
  it('drops properties the caller attached that are not on the allowlist', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

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

    const [, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    const text = await payload.text();
    const body = JSON.parse(text) as Record<string, unknown>;

    expect(Object.keys(body).toSorted()).toEqual(['did', 'ev', 'ok', 'seq', 'sid', 'source', 'v']);
    expect(text).not.toContain('IMG_1234');
    expect(text).not.toContain('4032');
    expect(text).not.toContain('data:image');
  });

  it('omits an absent optional field rather than serializing it as null', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    track({ ev: 'export_result', via: 'share', outcome: 'shared', frame: 'design-1' });

    const [, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    const body = JSON.parse(await payload.text()) as Record<string, unknown>;
    expect('err' in body).toBe(false);
  });

  it('carries err when present', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    track({
      ev: 'export_result',
      via: 'share',
      outcome: 'failed',
      frame: 'design-1',
      err: 'NotAllowedError',
    });

    const [, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    const body = JSON.parse(await payload.text()) as Record<string, unknown>;
    expect(body.err).toBe('NotAllowedError');
  });

  it('envelope fields cannot be shadowed by a caller-supplied value', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

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

    const [, payload] = beaconSpy.mock.calls[0] as [string, Blob];
    const body = JSON.parse(await payload.text()) as Record<string, unknown>;
    expect(body.v).toBe(1);
    expect(body.did).not.toBe('spoofed-device');
    expect(body.sid).not.toBe('spoofed-session');
    expect(body.seq).toBe(1);
  });

  it('increments seq across successive track() calls', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });
    track({ ev: 'source_click', source: 'library' });

    const first = JSON.parse(await (beaconSpy.mock.calls[0] as [string, Blob])[1].text()) as {
      seq: number;
    };
    const second = JSON.parse(await (beaconSpy.mock.calls[1] as [string, Blob])[1].text()) as {
      seq: number;
    };
    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
  });

  it('falls back to fetch with keepalive when sendBeacon returns false', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(beaconSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
  });

  it('does not throw when sendBeacon itself throws', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockImplementation(() => {
      throw new Error('beacon broke');
    });
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });

    const { track } = await import('./track.ts');
    expect(() => track({ ev: 'source_click', source: 'camera' })).not.toThrow();
  });

  it('does not produce an unhandled rejection when the fetch fallback rejects', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const beaconSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beaconSpy });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const { track } = await import('./track.ts');
    expect(() => track({ ev: 'source_click', source: 'camera' })).not.toThrow();

    // Let the rejected fetch promise's .catch() run before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('falls back to fetch when navigator.sendBeacon is entirely absent', async () => {
    vi.stubEnv('VITE_TELEMETRY_URL', ENDPOINT);
    const { sendBeacon: _omit, ...navWithoutBeacon } = navigator as Navigator & {
      sendBeacon?: unknown;
    };
    vi.stubGlobal('navigator', navWithoutBeacon);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());

    const { track } = await import('./track.ts');
    track({ ev: 'source_click', source: 'camera' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
