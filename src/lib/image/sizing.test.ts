import { describe, expect, it } from 'vitest';
import { computeWorkingSize } from './sizing.ts';

describe('computeWorkingSize', () => {
  it('leaves an image untouched when it is already within the cap', () => {
    expect(computeWorkingSize(600, 800, 3000)).toEqual({ width: 600, height: 800 });
  });

  it('leaves an image untouched when its longest edge exactly equals the cap', () => {
    expect(computeWorkingSize(3000, 1500, 3000)).toEqual({ width: 3000, height: 1500 });
  });

  it('downscales a landscape image so its longest edge matches the cap', () => {
    const result = computeWorkingSize(4000, 3000, 3000);
    expect(result.width).toBe(3000);
    expect(result.height).toBe(2250);
  });

  it('downscales a portrait image so its longest edge matches the cap', () => {
    const result = computeWorkingSize(3000, 4000, 3000);
    expect(result.width).toBe(2250);
    expect(result.height).toBe(3000);
  });

  it('preserves aspect ratio within rounding', () => {
    const sourceWidth = 5472;
    const sourceHeight = 3648;
    const result = computeWorkingSize(sourceWidth, sourceHeight, 3000);
    const sourceRatio = sourceWidth / sourceHeight;
    const resultRatio = result.width / result.height;
    expect(resultRatio).toBeCloseTo(sourceRatio, 2);
  });

  it('never produces a zero-pixel dimension for extreme aspect ratios', () => {
    const result = computeWorkingSize(10000, 10, 3000);
    expect(result.width).toBe(3000);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('honors a custom maxEdge', () => {
    expect(computeWorkingSize(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});
