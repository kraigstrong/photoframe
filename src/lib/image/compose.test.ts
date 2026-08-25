/// <reference types="node" />
// This file reads fixture bytes off disk via Node's `fs`, which needs
// `@types/node`. tsconfig.app.json intentionally omits "node" from its
// global `types` (app/browser code must not depend on Node), so it's pulled
// in explicitly here, scoped to this test file only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage, type Image as CanvasPackageImage } from 'canvas';
import { describe, expect, it, vi } from 'vitest';
import { eventConfig } from '../../config/index.ts';
import { buildExportFilename, exportImage } from './compose.ts';
import { coverFit } from './geometry.ts';
import type { WorkingImageSource } from './source.ts';

// Vitest runs with the repo root as cwd, so this is stable regardless of
// which file imports this module (Vite-transformed `import.meta.url` is not
// a real `file:` URL, so it can't be used to derive this path instead).
const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures');

/**
 * These tests feed `exportImage` real `CanvasImageSource` objects without
 * going through `decode()` (jsdom can't fire real <img> load events — see
 * decode.test.ts and FIXTURES.md). The "photo" is a plain jsdom canvas we
 * paint ourselves; the overlay is the checked-in fixture PNG with a known
 * pixel map, loaded via node-canvas's `loadImage` directly from its file
 * bytes.
 */

function makeSolidColorPhoto(width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('jsdom canvas 2D context unavailable in this environment.');
  }
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function makeFakeWorkingImage(
  drawable: CanvasImageSource,
  width: number,
  height: number,
  releaseSpy?: () => void,
): WorkingImageSource {
  return {
    src: 'about:blank',
    width,
    height,
    drawable,
    release: releaseSpy ?? (() => {}),
  };
}

async function loadOverlayFixture(): Promise<CanvasPackageImage> {
  const bytes = readFileSync(path.join(FIXTURES_DIR, 'test-overlay-400x500.png'));
  return loadImage(bytes);
}

/** Reads a single pixel out of an exported JPEG blob via node-canvas. */
async function readExportedPixel(
  blob: Blob,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  const decoded = await loadImage(buffer);
  const canvas = createCanvas(decoded.width, decoded.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(decoded, 0, 0);
  const { data } = ctx.getImageData(x, y, 1, 1);
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
}

describe('exportImage', () => {
  it('produces a JPEG blob at exactly the configured output dimensions', async () => {
    const photoWidth = 400;
    const photoHeight = 500;
    const photo = makeSolidColorPhoto(photoWidth, photoHeight, 'rgb(255, 0, 0)');
    const image = makeFakeWorkingImage(photo, photoWidth, photoHeight);
    const transform = coverFit(image, eventConfig.outputWidth, eventConfig.outputHeight);
    const overlay = await loadOverlayFixture();

    const exported = await exportImage(image, transform, overlay as unknown as CanvasImageSource);
    try {
      expect(exported.blob.type).toBe('image/jpeg');
      expect(exported.width).toBe(eventConfig.outputWidth);
      expect(exported.height).toBe(eventConfig.outputHeight);

      const decodedBuffer = Buffer.from(await exported.blob.arrayBuffer());
      const decoded = await loadImage(decodedBuffer);
      expect(decoded.width).toBe(eventConfig.outputWidth);
      expect(decoded.height).toBe(eventConfig.outputHeight);
    } finally {
      exported.release();
    }
  });

  it("shows the overlay's cyan border at the export's edges, over the photo", async () => {
    const photoWidth = 400;
    const photoHeight = 500;
    const photo = makeSolidColorPhoto(photoWidth, photoHeight, 'rgb(255, 0, 0)');
    const image = makeFakeWorkingImage(photo, photoWidth, photoHeight);
    const transform = coverFit(image, eventConfig.outputWidth, eventConfig.outputHeight);
    const overlay = await loadOverlayFixture();

    const exported = await exportImage(image, transform, overlay as unknown as CanvasImageSource);
    try {
      // Comfortably inside the scaled border (40/400 * 1080 = 108px), away
      // from any JPEG block-boundary blending.
      const [r, g, b, a] = await readExportedPixel(exported.blob, 20, 20);
      expect(r).toBeLessThan(80);
      expect(g).toBeGreaterThan(150);
      expect(b).toBeGreaterThan(150);
      expect(a).toBe(255);
    } finally {
      exported.release();
    }
  });

  it('shows the photo (not the overlay) at the center, where the overlay is transparent', async () => {
    const photoWidth = 400;
    const photoHeight = 500;
    const photo = makeSolidColorPhoto(photoWidth, photoHeight, 'rgb(255, 0, 0)');
    const image = makeFakeWorkingImage(photo, photoWidth, photoHeight);
    const transform = coverFit(image, eventConfig.outputWidth, eventConfig.outputHeight);
    const overlay = await loadOverlayFixture();

    const exported = await exportImage(image, transform, overlay as unknown as CanvasImageSource);
    try {
      const centerX = Math.round(eventConfig.outputWidth / 2);
      const centerY = Math.round(eventConfig.outputHeight / 2);
      const [r, g, b] = await readExportedPixel(exported.blob, centerX, centerY);
      expect(r).toBeGreaterThan(150);
      expect(g).toBeLessThan(80);
      expect(b).toBeLessThan(80);
    } finally {
      exported.release();
    }
  });

  it('release() revokes the object URL and is safe to call twice', async () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const photo = makeSolidColorPhoto(100, 100, 'rgb(0, 0, 0)');
    const image = makeFakeWorkingImage(photo, 100, 100);
    const transform = coverFit(image, eventConfig.outputWidth, eventConfig.outputHeight);
    const overlay = await loadOverlayFixture();

    const exported = await exportImage(image, transform, overlay as unknown as CanvasImageSource);
    expect(() => {
      exported.release();
      exported.release();
    }).not.toThrow();
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith(exported.objectUrl);
    revokeSpy.mockRestore();
  });

  it('rejects when the WorkingImage has no backing pixel source (e.g. already released)', async () => {
    const overlay = await loadOverlayFixture();
    const released: WorkingImageSource = {
      src: 'about:blank',
      width: 100,
      height: 100,
      drawable: null,
      release: () => {},
    };
    const transform = { scale: 1, x: 0, y: 0 };

    await expect(
      exportImage(released, transform, overlay as unknown as CanvasImageSource),
    ).rejects.toThrow(/released|no backing pixel source/i);
  });
});

describe('buildExportFilename', () => {
  it('uses the configured prefix and a .jpg suffix', () => {
    const filename = buildExportFilename(eventConfig.filenamePrefix);
    expect(filename.startsWith(`${eventConfig.filenamePrefix}-`)).toBe(true);
    expect(filename.endsWith('.jpg')).toBe(true);
  });

  it('sanitizes unsafe characters out of the prefix', () => {
    const filename = buildExportFilename('My Event! 2026 / Summer');
    expect(filename).toMatch(/^[a-z0-9-]+\.jpg$/);
  });

  it('produces different filenames on successive calls', () => {
    const a = buildExportFilename('event');
    const b = buildExportFilename('event');
    expect(a).not.toBe(b);
  });

  it('falls back to a safe default when the prefix sanitizes to nothing', () => {
    const filename = buildExportFilename('!!!');
    expect(filename.startsWith('photo-')).toBe(true);
  });
});
