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

  it('claims the photo does not leave the device', () => {
    // Asserts the CLAIM, not one literal phrasing of it. The wording is
    // allowed to change; what must not silently disappear is the promise
    // itself, which is the whole reason a guest hands over a photo.
    const msg = eventConfig.privacyMessage.toLowerCase();
    expect(msg).toContain('your photo');
    expect(msg).toMatch(/never leaves|not uploaded|does not leave/);
  });

  it('stays short enough to hold one line on a 375px phone', () => {
    // The landing screen has no vertical slack at 375x667, and `.privacy`
    // is deliberately width-unconstrained so this line does not wrap.
    expect(eventConfig.privacyMessage.length).toBeLessThanOrEqual(40);
  });

  it('offers more than one overlay design for the editing-screen picker', () => {
    expect(eventConfig.overlays.length).toBeGreaterThan(1);
  });

  it('references only same-origin overlay assets and thumbnails', () => {
    for (const overlay of eventConfig.overlays) {
      expect(overlay.asset).not.toMatch(/^https?:\/\//);
      expect(overlay.thumbnail).not.toMatch(/^https?:\/\//);
    }
  });

  it('references a same-origin preview photo', () => {
    expect(eventConfig.previewPhoto).not.toMatch(/^https?:\/\//);
  });
});
