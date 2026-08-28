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

describe('telemetryMessage', () => {
  it('discloses that usage is counted and that the photo is not', () => {
    const msg = eventConfig.telemetryMessage.toLowerCase();
    expect(msg).toContain('anonymous');
    expect(msg).toContain('photo');
  });

  it('stays short enough to read at a glance on a phone', () => {
    expect(eventConfig.telemetryMessage.length).toBeLessThanOrEqual(120);
  });

  it('does not weaken the photo claim, which must still stand on its own', () => {
    expect(eventConfig.privacyMessage).toContain('not uploaded');
  });
});
