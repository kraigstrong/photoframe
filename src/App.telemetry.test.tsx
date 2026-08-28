import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { imageEngine } from './lib/image/index.ts';
import type { ExportedImage, Transform, WorkingImage } from './lib/image/types.ts';

/**
 * Drives a complete, realistic guest session through the REAL component
 * tree and the REAL useGuestFlow hook — landing, a source click, a file
 * selection, a frame change, and a share/download attempt — with telemetry
 * "enabled" (a stubbed `VITE_TELEMETRY_URL`) and `navigator.sendBeacon`
 * captured instead of the real image engine and share sheet.
 *
 * This is the regression net for the whole telemetry privacy guarantee: it
 * asserts, over every payload actually sent, that (1) only allowlisted keys
 * ever appear and (2) nothing photo-derived (filename, dimensions, a
 * `data:`/`blob:` URL) ever appears in the serialized text — not just that
 * `track()`'s own allowlist logic is correct in isolation (see track.test.ts
 * for that), but that no real call site smuggles something past it.
 *
 * Only `imageEngine` (decode/export) and the overlay preload's `Image`
 * constructor are faked, mirroring the same necessity documented in
 * state/useGuestFlow.test.ts: jsdom has no `createImageBitmap` and its real
 * `<img>` never fires load/error (see tests/fixtures/FIXTURES.md), so real
 * decoding can only be exercised in Playwright. Everything else — routing
 * on AppState, LandingScreen/EditingScreen/FallbackScreen, the hook's own
 * orchestration and telemetry call sites — is real.
 */
vi.mock('./lib/image/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/image/index.ts')>();
  return {
    ...actual,
    imageEngine: {
      decode: vi.fn(),
      coverFit: vi.fn(),
      clamp: vi.fn(),
      export: vi.fn(),
    },
  };
});

const mockedEngine = vi.mocked(imageEngine);

/** Real fixture bytes, so a filename/content check on telemetry payloads is
 * meaningful rather than vacuous — see tests/fixtures/FIXTURES.md. */
const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'portrait.jpg',
);
const PORTRAIT_BYTES = readFileSync(FIXTURE_PATH);

/**
 * jsdom's real Image never fires load/error for any src (no resource
 * loader), so the overlay preload needs a controllable fake — identical
 * technique to state/useGuestFlow.test.ts.
 */
class FakeImage {
  src = '';
  private listeners: Record<string, Array<() => void>> = {};
  addEventListener(type: string, cb: () => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }
  fireLoad(): void {
    this.listeners.load?.slice().forEach((cb) => cb());
  }
}

let createdImages: FakeImage[] = [];
const originalImage = globalThis.Image;

async function loadOverlaysSuccessfully(): Promise<void> {
  await act(async () => {
    createdImages.forEach((img) => img.fireLoad());
    await Promise.resolve();
  });
}

function makeWorkingImage(overrides: Partial<WorkingImage> = {}): WorkingImage {
  return { src: 'blob:working', width: 600, height: 800, release: vi.fn(), ...overrides };
}

function makeExportedImage(overrides: Partial<ExportedImage> = {}): ExportedImage {
  return {
    blob: new Blob(['fake'], { type: 'image/jpeg' }),
    objectUrl: 'blob:exported',
    filename: 'event-1.jpg',
    width: 1080,
    height: 1350,
    release: vi.fn(),
    ...overrides,
  };
}

const BASELINE_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 };
const TELEMETRY_ENDPOINT = 'https://telemetry.test/e';

/** The complete, closed set of fields any telemetry payload may ever carry
 * (envelope fields plus every field any TelemetryEvent variant declares).
 * This is deliberately maintained independently of EVENT_FIELDS in track.ts
 * so this test can't be fooled by a bug in that allowlist itself. */
const ALLOWED_KEYS = new Set([
  'v',
  'did',
  'sid',
  'seq',
  'ev',
  'platform',
  'canShareFiles',
  'source',
  'ok',
  'frame',
  'via',
  'outcome',
  'err',
  'kind',
]);

type Captured = { url: string; blob: Blob };
let captured: Captured[] = [];
let beaconSpy: ReturnType<typeof vi.fn>;

async function payloads(): Promise<Record<string, unknown>[]> {
  return Promise.all(
    captured.map(async (c) => JSON.parse(await c.blob.text()) as Record<string, unknown>),
  );
}

async function rawTexts(): Promise<string[]> {
  return Promise.all(captured.map((c) => c.blob.text()));
}

beforeEach(() => {
  vi.stubEnv('VITE_TELEMETRY_URL', TELEMETRY_ENDPOINT);

  // Device/session ids are random UUIDs (see ids.ts) and therefore could, in
  // extremely rare cases, coincidentally contain a digit sequence this file
  // checks payload text for (e.g. "600"). Pin them to an all-hex-letters
  // value so the "no photo-derived content" assertion below can never be
  // spuriously flaky.
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

  createdImages = [];
  // @ts-expect-error test-only global shim; see FakeImage above.
  globalThis.Image = vi.fn(function ImageConstructor() {
    const img = new FakeImage();
    createdImages.push(img);
    return img;
  });

  mockedEngine.decode.mockReset();
  mockedEngine.coverFit.mockReset().mockReturnValue(BASELINE_TRANSFORM);
  mockedEngine.clamp.mockReset();
  mockedEngine.export.mockReset();

  captured = [];
  beaconSpy = vi.fn((url: string, blob: Blob) => {
    captured.push({ url, blob });
    return true;
  });
  Object.defineProperty(navigator, 'sendBeacon', {
    value: beaconSpy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  globalThis.Image = originalImage;
  // Not restoring navigator.sendBeacon to its original value: every test
  // re-installs its own spy via Object.defineProperty in beforeEach, so
  // there is nothing left over to leak between tests in this file.
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('App telemetry: a realistic guest session', () => {
  it('emits only allowlisted, non-photo-derived events in seq order across landing -> source click -> file select -> frame change -> share -> download', async () => {
    const user = userEvent.setup();
    const workingImage = makeWorkingImage();
    const exportedImage = makeExportedImage();
    mockedEngine.decode.mockResolvedValue(workingImage);
    mockedEngine.export.mockResolvedValue(exportedImage);

    render(<App />);

    // app_open fires once, on mount, before any guest interaction.
    await waitFor(() => expect(captured.length).toBeGreaterThanOrEqual(1));

    await loadOverlaysSuccessfully();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose from camera roll' })).toBeEnabled(),
    );

    // source_click, then a real File built from the checked-in fixture.
    await user.click(screen.getByRole('button', { name: 'Choose from camera roll' }));

    const file = new File([PORTRAIT_BYTES], 'portrait.jpg', { type: 'image/jpeg' });
    const libraryInput = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    await user.upload(libraryInput, file);

    // photo_load fires once decode resolves and the editing screen mounts.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save or share' })).toBeInTheDocument(),
      {
        timeout: 3000,
      },
    );

    // Re-tapping the ALREADY-selected frame must stay silent (assertion 5).
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Design 1' })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('radio', { name: 'Design 1' }));
    expect((await payloads()).filter((e) => e.ev === 'frame_select')).toHaveLength(0);

    // Now a genuine frame_select: pick a different frame.
    await user.click(screen.getByRole('radio', { name: 'Design 2' }));
    expect((await payloads()).filter((e) => e.ev === 'frame_select')).toHaveLength(1);

    // Wait out the re-export (debounced/immediate depending on path) so
    // Save/Share re-enables.
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Save or share' })).toBeEnabled(),
      {
        timeout: 3000,
      },
    );

    // export_attempt (share) + export_result: jsdom has no navigator.share,
    // so this resolves 'unavailable' and drops to the fallback screen.
    await user.click(screen.getByRole('button', { name: 'Save or share' }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument(),
      {
        timeout: 3000,
      },
    );

    // export_attempt (download). link.click() gives no success signal, so
    // there is deliberately no export_result for this path.
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: 'Download' }));
    clickSpy.mockRestore();

    const events = await payloads();
    const texts = await rawTexts();

    // --- Assertion 1: the union of every key across every payload is a
    // subset of the allowlist. This is the regression net for the whole
    // privacy guarantee. ---
    const allKeysUsed = new Set(events.flatMap((event) => Object.keys(event)));
    for (const key of allKeysUsed) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }

    // --- Assertion 2: no payload's serialized text contains anything
    // photo-derived: the fixture's filename, any image dimension, a data:
    // or blob: URL. ---
    for (const text of texts) {
      expect(text).not.toContain('portrait');
      expect(text).not.toContain('portrait.jpg');
      // Fixture rendered size (FIXTURES.md) and this test's mock
      // WorkingImage/ExportedImage dimensions.
      for (const dimension of ['600', '800', '1080', '1350']) {
        expect(text).not.toContain(dimension);
      }
      expect(text).not.toContain('data:');
      expect(text).not.toContain('blob:');
    }

    // --- Assertion 3: the expected event sequence, in seq order, for a
    // happy-path session. ---
    expect(events.map((e) => e.ev)).toEqual([
      'app_open',
      'source_click',
      'photo_load',
      'frame_select',
      'export_attempt',
      'export_result',
      'export_attempt',
    ]);
    const seqs = events.map((e) => e.seq as number);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    }

    // Spot-check the payloads that carry the interesting distinguishing
    // fields, on top of the blanket key-allowlist check above.
    expect(events[1]).toMatchObject({ ev: 'source_click', source: 'library' });
    expect(events[2]).toMatchObject({ ev: 'photo_load', source: 'library', ok: true });
    expect(events[4]).toMatchObject({ ev: 'export_attempt', via: 'share' });
    expect(events[5]).toMatchObject({ ev: 'export_result', via: 'share', outcome: 'unavailable' });
    expect(events[6]).toMatchObject({ ev: 'export_attempt', via: 'download' });
  });

  it('reports source_click when the guest presses a button, even if the native picker is then cancelled, without a following photo_load', async () => {
    const user = userEvent.setup();
    render(<App />);
    await loadOverlaysSuccessfully();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take a photo' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Take a photo' }));

    const cameraInput = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
    // Simulate the guest dismissing the native picker without choosing a
    // photo: the input still fires `change`, but with no files.
    fireEvent.change(cameraInput, { target: { files: [] } });

    // Give any (incorrect) async photo_load a chance to fire before
    // asserting its absence.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const events = (await payloads()).map((e) => e.ev);
    expect(events).toContain('source_click');
    expect(events).not.toContain('photo_load');
  });
});
