import { describe, expect, it } from 'vitest';
import { eventConfig, outputAspectRatio } from './index.ts';

describe('eventConfig', () => {
  it('uses the specified 1080x1350 4:5 output', () => {
    expect(eventConfig.outputWidth).toBe(1080);
    expect(eventConfig.outputHeight).toBe(1350);
    expect(outputAspectRatio).toBeCloseTo(4 / 5, 5);
  });

  it('keeps JPEG quality within a valid range', () => {
    expect(eventConfig.jpegQuality).toBeGreaterThan(0);
    expect(eventConfig.jpegQuality).toBeLessThanOrEqual(1);
  });

  it('states that the photo is not uploaded or stored', () => {
    expect(eventConfig.privacyMessage.toLowerCase()).toContain('not upload');
  });

  it('references a same-origin overlay asset', () => {
    expect(eventConfig.overlayAsset).not.toMatch(/^https?:\/\//);
  });
});
