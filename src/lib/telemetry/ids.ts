/**
 * Locally-generated identifiers for telemetry envelopes.
 *
 * Privacy posture: every id here is a random value minted and stored on the
 * guest's own device. None is a fingerprint, and none is derived from IP
 * address, user agent, or any other characteristic of the device or
 * browser — a fresh install with storage cleared gets a fresh, unrelated
 * device id.
 *
 * Nothing in this module may ever throw. Safari private mode has
 * historically thrown on `localStorage`/`sessionStorage` access, and
 * jsdom/embedded webviews can too. Every storage read and write is wrapped
 * in try/catch; when storage is unusable, ids fall back to a module-level
 * in-memory value that stays stable for the page's lifetime.
 */

const DEVICE_ID_KEY = 'pf:did';
const SESSION_ID_KEY = 'pf:sid';
const SEQ_KEY = 'pf:seq';

let cachedDeviceId: string | undefined;
let cachedSessionId: string | undefined;
let cachedSeq: number | undefined;

/** Mints a random id. Only needs to be unique, not cryptographically strong. */
function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the next strategy
  }
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // fall through to the last-resort strategy
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unusable (private mode, quota, embedded webview) — the
    // in-memory cache set by the caller keeps the value stable regardless.
  }
}

/** A stored id is only valid if it's a genuinely non-empty string. */
function isValidId(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0;
}

function getOrCreateId(storage: Storage | undefined, key: string): string {
  if (storage) {
    const existing = readStorage(storage, key);
    if (isValidId(existing)) {
      return existing;
    }
    const fresh = randomId();
    writeStorage(storage, key, fresh);
    return fresh;
  }
  return randomId();
}

function getLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function getSessionStorage(): Storage | undefined {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Persistent device id, stable across visits. `localStorage` key `pf:did`. */
export function getDeviceId(): string {
  if (cachedDeviceId === undefined) {
    cachedDeviceId = getOrCreateId(getLocalStorage(), DEVICE_ID_KEY);
  }
  return cachedDeviceId;
}

/** Per-tab session id. Survives a reload, dies with the tab. `sessionStorage` key `pf:sid`. */
export function getSessionId(): string {
  if (cachedSessionId === undefined) {
    cachedSessionId = getOrCreateId(getSessionStorage(), SESSION_ID_KEY);
  }
  return cachedSessionId;
}

/** A stored seq is only valid if it parses to a finite, non-negative integer. */
function isValidSeq(value: string | null): boolean {
  if (value === null) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0;
}

/**
 * Monotonic per-session counter, starting at 1. Persisted to `sessionStorage`
 * under `pf:seq` so a mid-session tab reload — which this app can genuinely
 * trigger, since decoding a large photo transiently allocates ~195 MB and
 * iOS may evict the tab while the native camera is in front — resumes
 * numbering instead of restarting it and creating duplicate `seq` values
 * within one session.
 */
export function nextSeq(): number {
  const storage = getSessionStorage();

  if (cachedSeq === undefined) {
    const stored = storage ? readStorage(storage, SEQ_KEY) : null;
    cachedSeq = isValidSeq(stored) ? Number(stored) : 0;
  }

  cachedSeq += 1;

  if (storage) {
    writeStorage(storage, SEQ_KEY, String(cachedSeq));
  }

  return cachedSeq;
}
