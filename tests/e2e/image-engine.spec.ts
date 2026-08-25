/**
 * Browser-level tests for the image engine (src/lib/image/**).
 *
 * jsdom can decode real pixels via the `canvas` package (see the colocated
 * `*.test.ts` unit tests), but it never fires real `<img>`/`createImageBitmap`
 * load events, so anything that depends on the browser's *own* file decoding
 * — EXIF-orientation-aware `createImageBitmap`, real corrupt-file rejection,
 * true downscaling of a real JPEG — has to run in a real browser. That's what
 * this file does.
 *
 * There is no dedicated test harness page (App.tsx is out of this
 * milestone's ownership and doesn't wire the engine in yet). Instead, the
 * engine module is bundled with Vite's JS API directly from this test file
 * and injected into the already-running preview server's page as a plain
 * script, exposing `window.ImageEngineTestBundle`. Fixture files are read on
 * the Node side and handed to the page as `data:` URLs, which — per prior
 * investigation — decode reliably via `<img>`/`fetch` inside Playwright;
 * plain `file://` URLs do not.
 *
 * Every `page.evaluate` callback below is its own self-contained function:
 * it is serialized and executed inside the browser, so it cannot close over
 * anything from this file except the values explicitly passed as arguments
 * (types are erased before serialization, so type annotations referencing
 * `ImageEngineTestBundle` etc. below are fine; helper *functions* are not,
 * and are inlined per-callback instead).
 */
/// <reference lib="dom" />
// tsconfig.node.json's `lib` is `["ES2023"]` (no DOM), since e2e specs are
// ordinary Node code driving a browser. The `page.evaluate` callback bodies
// below, however, are type-checked as if they ran in-process too — they
// execute in the browser, but TS has no way to know that — so `window`,
// `document`, and `Image` need to be pulled in explicitly for this file.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { build, type Rollup } from 'vite';

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

function readFixtureBase64(filename: string): string {
  return readFileSync(path.join(FIXTURES_DIR, filename)).toString('base64');
}

/** Shape of `window.ImageEngineTestBundle`, matching src/lib/image/index.ts's exports. */
type EngineWorkingImage = { src: string; width: number; height: number; release: () => void };
type EngineTransform = { scale: number; x: number; y: number };
type EngineExportedImage = {
  blob: Blob;
  objectUrl: string;
  filename: string;
  width: number;
  height: number;
  release: () => void;
};
type ImageEngineTestBundle = {
  imageEngine: {
    decode: (file: File) => Promise<EngineWorkingImage>;
    coverFit: (
      image: EngineWorkingImage,
      frameWidth: number,
      frameHeight: number,
    ) => EngineTransform;
    export: (
      image: EngineWorkingImage,
      transform: EngineTransform,
      overlay: CanvasImageSource,
    ) => Promise<EngineExportedImage>;
  };
  eventConfig: { outputWidth: number; outputHeight: number };
};

// Bundling is somewhat expensive; do it once and reuse the result for every
// test in this file.
let bundleCodePromise: Promise<string> | null = null;

async function getBundleCode(): Promise<string> {
  bundleCodePromise ??= (async () => {
    const buildResult = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        target: 'es2020',
        lib: {
          entry: path.resolve(process.cwd(), 'src/lib/image/index.ts'),
          formats: ['iife'],
          name: 'ImageEngineTestBundle',
          fileName: () => 'image-engine.test-bundle.js',
        },
      },
    });
    // Vite's `build()` returns `RollupOutput | RollupOutput[]` (an array,
    // empirically, even for a single lib format) — normalize to one result.
    const result = (Array.isArray(buildResult) ? buildResult[0] : buildResult) as
      Rollup.RollupOutput | undefined;

    const entryChunk = result?.output.find((item) => item.type === 'chunk' && item.isEntry);
    if (!entryChunk || entryChunk.type !== 'chunk') {
      throw new Error('Failed to bundle src/lib/image/index.ts for Playwright tests.');
    }
    return entryChunk.code;
  })();
  return bundleCodePromise;
}

/** Navigates to the running preview server and injects the engine bundle. */
async function preparePage(page: Page): Promise<void> {
  const code = await getBundleCode();
  await page.goto('/');
  await page.addScriptTag({ content: code });
  await page.waitForFunction(() => 'ImageEngineTestBundle' in window);
}

type RGBA = [number, number, number, number];

function expectColorClose(actual: RGBA, expected: [number, number, number], tolerance = 40): void {
  expect(actual[0], `red channel (got rgba(${actual.join(',')}))`).toBeGreaterThanOrEqual(
    expected[0] - tolerance,
  );
  expect(actual[0]).toBeLessThanOrEqual(expected[0] + tolerance);
  expect(actual[1]).toBeGreaterThanOrEqual(expected[1] - tolerance);
  expect(actual[1]).toBeLessThanOrEqual(expected[1] + tolerance);
  expect(actual[2]).toBeGreaterThanOrEqual(expected[2] - tolerance);
  expect(actual[2]).toBeLessThanOrEqual(expected[2] + tolerance);
}

test.describe('decode()', () => {
  for (const [fixture, expectedWidth, expectedHeight] of [
    ['portrait.jpg', 600, 800],
    ['landscape.jpg', 800, 600],
    ['square.jpg', 700, 700],
  ] as const) {
    test(`decodes ${fixture} at its native ${expectedWidth}x${expectedHeight}`, async ({
      page,
    }) => {
      await preparePage(page);
      const fileBase64 = readFixtureBase64(fixture);

      const dims = await page.evaluate(
        async (args: { fileBase64: string; filename: string }) => {
          const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
            .ImageEngineTestBundle;
          const blob = await fetch(`data:image/jpeg;base64,${args.fileBase64}`).then((r) =>
            r.blob(),
          );
          const file = new File([blob], args.filename, { type: 'image/jpeg' });
          const image = await bundle.imageEngine.decode(file);
          const result = { width: image.width, height: image.height };
          image.release();
          return result;
        },
        { fileBase64, filename: fixture },
      );

      expect(dims.width).toBe(expectedWidth);
      expect(dims.height).toBe(expectedHeight);
    });
  }

  test('respects EXIF orientation: exif-rotated-90cw.jpg renders at 600x800, not 800x600', async ({
    page,
  }) => {
    await preparePage(page);
    const fileBase64 = readFixtureBase64('exif-rotated-90cw.jpg');

    const result = await page.evaluate(
      async (args: { fileBase64: string }) => {
        const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
          .ImageEngineTestBundle;
        const blob = await fetch(`data:image/jpeg;base64,${args.fileBase64}`).then((r) => r.blob());
        const file = new File([blob], 'exif-rotated-90cw.jpg', { type: 'image/jpeg' });
        const image = await bundle.imageEngine.decode(file);

        // Sample well inside each quadrant of the *rendered* image via its
        // preview <img>, away from any center-line JPEG blockiness.
        const previewImg = new Image();
        await new Promise<void>((resolve, reject) => {
          previewImg.addEventListener('load', () => resolve(), { once: true });
          previewImg.addEventListener(
            'error',
            () => reject(new Error('Failed to load working-image preview.')),
            { once: true },
          );
          previewImg.src = image.src;
        });

        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('2D canvas context unavailable.');
        }
        ctx.drawImage(previewImg, 0, 0);

        const sample = (x: number, y: number): number[] =>
          Array.from(ctx.getImageData(x, y, 1, 1).data);

        const quadrants = {
          topLeft: sample(150, 200),
          topRight: sample(450, 200),
          bottomLeft: sample(150, 600),
          bottomRight: sample(450, 600),
        };

        const dims = { width: image.width, height: image.height };
        image.release();
        return { dims, quadrants };
      },
      { fileBase64 },
    );

    expect(result.dims.width).toBe(600);
    expect(result.dims.height).toBe(800);

    // Per FIXTURES.md: rotated 90deg CW from the stored landscape layout.
    expectColorClose(result.quadrants.topLeft as RGBA, [0, 0, 255]); // blue
    expectColorClose(result.quadrants.topRight as RGBA, [255, 0, 0]); // red
    expectColorClose(result.quadrants.bottomLeft as RGBA, [255, 212, 0]); // yellow
    expectColorClose(result.quadrants.bottomRight as RGBA, [0, 179, 0]); // green
  });

  test('caps oversized-4000x3000.jpg to MAX_WORKING_EDGE on its longest edge', async ({ page }) => {
    await preparePage(page);
    const fileBase64 = readFixtureBase64('oversized-4000x3000.jpg');

    const dims = await page.evaluate(
      async (args: { fileBase64: string }) => {
        const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
          .ImageEngineTestBundle;
        const blob = await fetch(`data:image/jpeg;base64,${args.fileBase64}`).then((r) => r.blob());
        const file = new File([blob], 'oversized-4000x3000.jpg', { type: 'image/jpeg' });
        const image = await bundle.imageEngine.decode(file);
        const result = { width: image.width, height: image.height };
        image.release();
        return result;
      },
      { fileBase64 },
    );

    expect(Math.max(dims.width, dims.height)).toBeLessThanOrEqual(3000);
    // The source is 4000x3000, so the longest edge (width) should have been
    // downscaled, proving this isn't just an accidental pass-through.
    expect(dims.width).toBe(3000);
    expect(dims.height).toBe(2250);
  });

  test('rejects corrupt.jpg cleanly, without hanging or crashing the page', async ({ page }) => {
    await preparePage(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const fileBase64 = readFixtureBase64('corrupt.jpg');

    const outcome = await page.evaluate(
      async (args: { fileBase64: string }) => {
        const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
          .ImageEngineTestBundle;
        const blob = await fetch(`data:image/jpeg;base64,${args.fileBase64}`).then((r) => r.blob());
        const file = new File([blob], 'corrupt.jpg', { type: 'image/jpeg' });
        try {
          await bundle.imageEngine.decode(file);
          return { rejected: false, message: '' };
        } catch (err) {
          return { rejected: true, message: err instanceof Error ? err.message : String(err) };
        }
      },
      { fileBase64 },
    );

    expect(outcome.rejected).toBe(true);
    expect(outcome.message).toBeTruthy();
    expect(pageErrors).toEqual([]);
  });

  test('rejects not-an-image.txt cleanly, without hanging or crashing the page', async ({
    page,
  }) => {
    await preparePage(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    const fileBase64 = readFixtureBase64('not-an-image.txt');

    const outcome = await page.evaluate(
      async (args: { fileBase64: string }) => {
        const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
          .ImageEngineTestBundle;
        const blob = await fetch(`data:text/plain;base64,${args.fileBase64}`).then((r) => r.blob());
        const file = new File([blob], 'not-an-image.txt', { type: 'text/plain' });
        try {
          await bundle.imageEngine.decode(file);
          return { rejected: false, message: '' };
        } catch (err) {
          return { rejected: true, message: err instanceof Error ? err.message : String(err) };
        }
      },
      { fileBase64 },
    );

    expect(outcome.rejected).toBe(true);
    expect(outcome.message).toBeTruthy();
    expect(pageErrors).toEqual([]);
  });
});

test.describe('full pipeline', () => {
  test('decode -> coverFit -> export produces a correctly-sized JPEG with the overlay on top', async ({
    page,
  }) => {
    await preparePage(page);
    const photoBase64 = readFixtureBase64('portrait.jpg');
    const overlayBase64 = readFixtureBase64('test-overlay-400x500.png');

    const result = await page.evaluate(
      async (args: { photoBase64: string; overlayBase64: string }) => {
        const bundle = (window as unknown as { ImageEngineTestBundle: ImageEngineTestBundle })
          .ImageEngineTestBundle;

        const photoBlob = await fetch(`data:image/jpeg;base64,${args.photoBase64}`).then((r) =>
          r.blob(),
        );
        const photoFile = new File([photoBlob], 'portrait.jpg', { type: 'image/jpeg' });
        const image = await bundle.imageEngine.decode(photoFile);

        const overlayImg = new Image();
        await new Promise<void>((resolve, reject) => {
          overlayImg.addEventListener('load', () => resolve(), { once: true });
          overlayImg.addEventListener('error', () => reject(new Error('Failed to load overlay.')), {
            once: true,
          });
          overlayImg.src = `data:image/png;base64,${args.overlayBase64}`;
        });

        const transform = bundle.imageEngine.coverFit(
          image,
          bundle.eventConfig.outputWidth,
          bundle.eventConfig.outputHeight,
        );
        const exported = await bundle.imageEngine.export(image, transform, overlayImg);

        // Decode the exported blob back to pixels to check its size and
        // that the overlay's cyan border made it to the edges.
        const exportedImg = new Image();
        await new Promise<void>((resolve, reject) => {
          exportedImg.addEventListener('load', () => resolve(), { once: true });
          exportedImg.addEventListener(
            'error',
            () => reject(new Error('Failed to load exported image.')),
            { once: true },
          );
          exportedImg.src = URL.createObjectURL(exported.blob);
        });
        const canvas = document.createElement('canvas');
        canvas.width = exportedImg.naturalWidth;
        canvas.height = exportedImg.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('2D canvas context unavailable.');
        }
        ctx.drawImage(exportedImg, 0, 0);
        const edgePixel = Array.from(ctx.getImageData(5, 5, 1, 1).data);

        const out = {
          type: exported.blob.type,
          width: exported.width,
          height: exported.height,
          decodedWidth: exportedImg.naturalWidth,
          decodedHeight: exportedImg.naturalHeight,
          filename: exported.filename,
          edgePixel,
        };
        image.release();
        exported.release();
        return out;
      },
      { photoBase64, overlayBase64 },
    );

    expect(result.type).toBe('image/jpeg');
    expect(result.decodedWidth).toBe(result.width);
    expect(result.decodedHeight).toBe(result.height);
    expect(result.filename).toMatch(/\.jpg$/);
    // Edge pixel should be the overlay's opaque cyan border, not the photo.
    expectColorClose(result.edgePixel as RGBA, [0, 200, 200]);
  });
});
