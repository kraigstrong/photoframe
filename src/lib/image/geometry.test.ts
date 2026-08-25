import { describe, expect, it } from 'vitest';
import { eventConfig } from '../../config/index.ts';
import {
  applyZoom,
  clamp,
  coverFit,
  coverScale,
  MAX_RELATIVE_ZOOM,
  MIN_RELATIVE_ZOOM,
} from './geometry.ts';

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1350; // 4:5, matches eventConfig's output frame.

describe('coverFit', () => {
  it('matches the frame exactly when the image already shares its aspect ratio', () => {
    const image = { width: 800, height: 1000 }; // also 4:5
    const transform = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(transform.scale).toBe(MIN_RELATIVE_ZOOM);
    expect(transform.x).toBeCloseTo(0, 6);
    expect(transform.y).toBeCloseTo(0, 6);
  });

  it('fits a portrait image by overflowing height and centering vertically', () => {
    const image = { width: 600, height: 1200 }; // narrower than the frame ratio
    const transform = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const scale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT);
    const renderedWidth = image.width * scale;
    const renderedHeight = image.height * scale;

    // Horizontal edge matches the frame exactly.
    expect(renderedWidth).toBeCloseTo(FRAME_WIDTH, 6);
    // Vertical overflow is centered: equal amounts above and below.
    expect(transform.x).toBeCloseTo(0, 6);
    expect(transform.y).toBeCloseTo((FRAME_HEIGHT - renderedHeight) / 2, 6);
    expect(transform.y).toBeLessThan(0);
  });

  it('fits a landscape image by overflowing width and centering horizontally', () => {
    const image = { width: 1600, height: 900 };
    const transform = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const scale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT);
    const renderedWidth = image.width * scale;
    const renderedHeight = image.height * scale;

    expect(renderedHeight).toBeCloseTo(FRAME_HEIGHT, 6);
    expect(transform.y).toBeCloseTo(0, 6);
    expect(transform.x).toBeCloseTo((FRAME_WIDTH - renderedWidth) / 2, 6);
    expect(transform.x).toBeLessThan(0);
  });

  it('fits a square image, overflowing on the frame axis it is relatively wider than', () => {
    const image = { width: 700, height: 700 };
    const transform = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const scale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT);
    const renderedWidth = image.width * scale;
    const renderedHeight = image.height * scale;

    expect(renderedHeight).toBeCloseTo(FRAME_HEIGHT, 6);
    expect(renderedWidth).toBeGreaterThan(FRAME_WIDTH);
    expect(transform.x).toBeLessThan(0);
    expect(transform.y).toBeCloseTo(0, 6);
  });

  it('never leaves an empty edge: rendered size always covers the frame', () => {
    for (const image of [
      { width: 4000, height: 3000 },
      { width: 300, height: 3000 },
      { width: 3000, height: 300 },
    ]) {
      const transform = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
      const scale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT) * transform.scale;
      expect(image.width * scale).toBeGreaterThanOrEqual(FRAME_WIDTH - 1e-6);
      expect(image.height * scale).toBeGreaterThanOrEqual(FRAME_HEIGHT - 1e-6);
    }
  });

  it('produces the real eventConfig output frame dimensions when used as intended', () => {
    const image = { width: 600, height: 800 };
    const transform = coverFit(image, eventConfig.outputWidth, eventConfig.outputHeight);
    expect(transform.scale).toBe(1);
  });
});

describe('clamp', () => {
  const image = { width: 600, height: 1200 };
  const baseline = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);

  it('leaves an already-valid transform unchanged', () => {
    const clamped = clamp(baseline, image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(clamped.scale).toBeCloseTo(baseline.scale, 6);
    expect(clamped.x).toBeCloseTo(baseline.x, 6);
    expect(clamped.y).toBeCloseTo(baseline.y, 6);
  });

  it('clamps scale below the minimum up to MIN_RELATIVE_ZOOM', () => {
    const clamped = clamp({ ...baseline, scale: 0.2 }, image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(clamped.scale).toBe(MIN_RELATIVE_ZOOM);
  });

  it('clamps scale above the maximum down to MAX_RELATIVE_ZOOM', () => {
    const clamped = clamp({ ...baseline, scale: 50 }, image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(clamped.scale).toBe(MAX_RELATIVE_ZOOM);
  });

  it('clamps translation so the image never reveals an empty edge, at any valid scale', () => {
    for (const scale of [MIN_RELATIVE_ZOOM, 1.5, 2, MAX_RELATIVE_ZOOM]) {
      // Push the transform way out of bounds in every direction.
      const extremeOffsets: Array<[number, number]> = [
        [-100000, -100000],
        [100000, 100000],
        [-100000, 100000],
        [100000, -100000],
      ];
      for (const [dx, dy] of extremeOffsets) {
        const clamped = clamp({ scale, x: dx, y: dy }, image, FRAME_WIDTH, FRAME_HEIGHT);
        const absoluteScale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT) * clamped.scale;
        const renderedWidth = image.width * absoluteScale;
        const renderedHeight = image.height * absoluteScale;

        // Left/top edge never reveals empty canvas (image starts at or before 0).
        expect(clamped.x).toBeLessThanOrEqual(1e-6);
        expect(clamped.y).toBeLessThanOrEqual(1e-6);
        // Right/bottom edge never reveals empty canvas (image ends at or after the frame edge).
        expect(clamped.x + renderedWidth).toBeGreaterThanOrEqual(FRAME_WIDTH - 1e-6);
        expect(clamped.y + renderedHeight).toBeGreaterThanOrEqual(FRAME_HEIGHT - 1e-6);
      }
    }
  });

  it('has zero horizontal slack (x pinned to 0) for a portrait image with no width overflow', () => {
    const clamped = clamp({ scale: 2, x: 999, y: 0 }, image, FRAME_WIDTH, FRAME_HEIGHT);
    // At baseline this image's rendered width already exactly matches the frame,
    // and zooming in only grows both dimensions, so x has no valid range but 0.
    expect(clamped.x).toBeCloseTo(0, 6);
  });
});

describe('applyZoom', () => {
  const image = { width: 600, height: 1200 };

  it('preserves the frame-center focal point when zooming in from a centered baseline', () => {
    const baseline = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const zoomed = applyZoom(baseline, 2, image, FRAME_WIDTH, FRAME_HEIGHT);
    const expected = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const absoluteScale = coverScale(image, FRAME_WIDTH, FRAME_HEIGHT) * 2;
    const renderedWidth = image.width * absoluteScale;
    const renderedHeight = image.height * absoluteScale;

    expect(zoomed.scale).toBe(2);
    // Zooming in on a centered image stays centered.
    expect(zoomed.x).toBeCloseTo((FRAME_WIDTH - renderedWidth) / 2, 4);
    expect(zoomed.y).toBeCloseTo((FRAME_HEIGHT - renderedHeight) / 2, 4);
    expect(expected).toBeDefined();
  });

  it('always returns a clamped, in-bounds transform', () => {
    const baseline = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const panned = { ...baseline, x: baseline.x, y: 0 }; // pushed to top edge
    const zoomed = applyZoom(panned, 1.5, image, FRAME_WIDTH, FRAME_HEIGHT);
    const reclamped = clamp(zoomed, image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(zoomed.x).toBeCloseTo(reclamped.x, 6);
    expect(zoomed.y).toBeCloseTo(reclamped.y, 6);
    expect(zoomed.scale).toBeCloseTo(reclamped.scale, 6);
  });

  it('clamps out-of-range requested scales', () => {
    const baseline = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(applyZoom(baseline, 10, image, FRAME_WIDTH, FRAME_HEIGHT).scale).toBe(MAX_RELATIVE_ZOOM);
    expect(applyZoom(baseline, 0.1, image, FRAME_WIDTH, FRAME_HEIGHT).scale).toBe(
      MIN_RELATIVE_ZOOM,
    );
  });

  it('zooming back out to the baseline scale returns to a centered transform', () => {
    const baseline = coverFit(image, FRAME_WIDTH, FRAME_HEIGHT);
    const zoomedIn = applyZoom(baseline, 3, image, FRAME_WIDTH, FRAME_HEIGHT);
    const zoomedBackOut = applyZoom(zoomedIn, 1, image, FRAME_WIDTH, FRAME_HEIGHT);
    expect(zoomedBackOut.x).toBeCloseTo(baseline.x, 4);
    expect(zoomedBackOut.y).toBeCloseTo(baseline.y, 4);
  });
});
