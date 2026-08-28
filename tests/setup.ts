import { afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

/**
 * A minimal in-memory `Storage` implementation, installed globally for every
 * test file.
 *
 * This Node version's own experimental global Web Storage shadows jsdom's
 * real `localStorage`/`sessionStorage` and is inert without a
 * `--localstorage-file` flag this project doesn't set, so `globalThis
 * .localStorage`/`.sessionStorage` are otherwise unusable in tests (reads
 * silently miss, writes silently no-op). `src/lib/telemetry/ids.ts` reads
 * both, so any test that exercises a telemetry-touching path (most of the
 * app, once telemetry is wired to real call sites) needs a working
 * implementation, not per-file stubs repeated everywhere.
 *
 * Deliberately not shared with the hand-rolled `createMemoryStorage` helpers
 * already living in `src/lib/telemetry/*.test.ts` — those pass today and
 * assert their own isolated behavior; this is only a baseline default so
 * *other* tests don't need to think about storage at all.
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

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});
