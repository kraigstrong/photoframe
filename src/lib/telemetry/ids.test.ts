import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A minimal in-memory `Storage` stand-in.
 *
 * The jsdom test environment's real `localStorage`/`sessionStorage` are
 * unreliable under this Node version (Node's own experimental global
 * Web Storage shadows jsdom's, and is inert without a
 * `--localstorage-file` flag we don't control here). Stubbing a small
 * hand-rolled implementation via `vi.stubGlobal` sidesteps that collision
 * entirely and lets these tests exercise ids.ts's real read/write/validate
 * logic deterministically.
 */
function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map<string, string>(Object.entries(initial));
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

let localMock: Storage;
let sessionMock: Storage;

describe('ids', () => {
  beforeEach(() => {
    localMock = createMemoryStorage();
    sessionMock = createMemoryStorage();
    vi.stubGlobal('localStorage', localMock);
    vi.stubGlobal('sessionStorage', sessionMock);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getDeviceId', () => {
    it('mints and returns a stable device id across repeated calls', async () => {
      const { getDeviceId } = await import('./ids.ts');
      const first = getDeviceId();
      const second = getDeviceId();
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThan(0);
    });

    it('persists to localStorage', async () => {
      const { getDeviceId } = await import('./ids.ts');
      const id = getDeviceId();
      expect(localMock.getItem('pf:did')).toBe(id);
    });

    it('reuses a pre-seeded value', async () => {
      localMock.setItem('pf:did', 'seeded-device-id');
      const { getDeviceId } = await import('./ids.ts');
      expect(getDeviceId()).toBe('seeded-device-id');
    });
  });

  describe('getSessionId', () => {
    it('persists to sessionStorage', async () => {
      const { getSessionId } = await import('./ids.ts');
      const id = getSessionId();
      expect(sessionMock.getItem('pf:sid')).toBe(id);
    });

    it('reuses a pre-seeded value', async () => {
      sessionMock.setItem('pf:sid', 'seeded-session-id');
      const { getSessionId } = await import('./ids.ts');
      expect(getSessionId()).toBe('seeded-session-id');
    });
  });

  describe('nextSeq', () => {
    it('returns 1, 2, 3…', async () => {
      const { nextSeq } = await import('./ids.ts');
      expect(nextSeq()).toBe(1);
      expect(nextSeq()).toBe(2);
      expect(nextSeq()).toBe(3);
    });

    it('resumes (does not restart) when a reload is simulated', async () => {
      const mod1 = await import('./ids.ts');
      expect(mod1.nextSeq()).toBe(1);
      expect(mod1.nextSeq()).toBe(2);

      // Simulate a tab reload: reset the module registry but leave the
      // (stubbed) sessionStorage intact, then re-import.
      vi.resetModules();
      const mod2 = await import('./ids.ts');
      expect(mod2.nextSeq()).toBe(3);
      expect(mod2.nextSeq()).toBe(4);
    });

    it('corrupt stored seq values are replaced rather than propagated', async () => {
      sessionMock.setItem('pf:seq', 'NaN');
      const { nextSeq } = await import('./ids.ts');
      expect(nextSeq()).toBe(1);
    });

    it('an object-shaped stored seq value is replaced rather than propagated', async () => {
      // sessionStorage values are always strings, but a value that stringifies
      // to something non-numeric should still be treated as corrupt.
      sessionMock.setItem('pf:seq', String({}));
      const { nextSeq } = await import('./ids.ts');
      expect(nextSeq()).toBe(1);
    });
  });

  describe('corrupt stored values', () => {
    it('an empty stored device id is replaced rather than reused', async () => {
      localMock.setItem('pf:did', '');
      const { getDeviceId } = await import('./ids.ts');
      const id = getDeviceId();
      expect(id.length).toBeGreaterThan(0);
    });

    it('an empty stored session id is replaced rather than reused', async () => {
      sessionMock.setItem('pf:sid', '');
      const { getSessionId } = await import('./ids.ts');
      const id = getSessionId();
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('storage entirely absent', () => {
    // Distinct from "storage throws": some embedded webviews, and Node's own
    // shadowing of jsdom's Web Storage, leave the global `undefined` rather
    // than throwing on access. ids.ts takes a different branch for this.
    beforeEach(() => {
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('sessionStorage', undefined);
      vi.resetModules();
    });

    it('getDeviceId returns a stable usable value', async () => {
      const { getDeviceId } = await import('./ids.ts');
      const first = getDeviceId();
      expect(first.length).toBeGreaterThan(0);
      expect(getDeviceId()).toBe(first);
    });

    it('getSessionId returns a stable usable value', async () => {
      const { getSessionId } = await import('./ids.ts');
      const first = getSessionId();
      expect(first.length).toBeGreaterThan(0);
      expect(getSessionId()).toBe(first);
    });

    it('nextSeq still increments from 1', async () => {
      const { nextSeq } = await import('./ids.ts');
      expect(nextSeq()).toBe(1);
      expect(nextSeq()).toBe(2);
    });
  });

  describe('storage throwing', () => {
    beforeEach(() => {
      vi.spyOn(localMock, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      vi.spyOn(localMock, 'setItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      vi.spyOn(sessionMock, 'getItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
      vi.spyOn(sessionMock, 'setItem').mockImplementation(() => {
        throw new Error('storage disabled');
      });
    });

    it('getDeviceId still returns a stable usable value when localStorage throws', async () => {
      const { getDeviceId } = await import('./ids.ts');
      const first = getDeviceId();
      const second = getDeviceId();
      expect(first.length).toBeGreaterThan(0);
      expect(first).toBe(second);
    });

    it('getSessionId still returns a stable usable value when sessionStorage throws', async () => {
      const { getSessionId } = await import('./ids.ts');
      const first = getSessionId();
      const second = getSessionId();
      expect(first.length).toBeGreaterThan(0);
      expect(first).toBe(second);
    });

    it('nextSeq still returns a stable, incrementing sequence when sessionStorage throws', async () => {
      const { nextSeq } = await import('./ids.ts');
      expect(nextSeq()).toBe(1);
      expect(nextSeq()).toBe(2);
    });
  });
});
