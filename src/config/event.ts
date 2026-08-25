import type { EventConfig } from './types.ts';
import overlayAsset from '../assets/overlay-placeholder.png';

/**
 * The single configured event for this deployment.
 *
 * To rebrand this app for a different event, edit this file and replace
 * `src/assets/overlay-placeholder.png`. See the README for overlay requirements.
 */
export const eventConfig: EventConfig = {
  eventName: 'Our Event',
  pageTitle: 'Our Event — Photo Frame',
  instruction:
    "Take a photo or choose one you already took. We'll add the event frame on this device.",
  privacyMessage: 'Your photo stays on this device. We do not upload or store it.',
  overlayAsset,
  outputWidth: 1080,
  outputHeight: 1350,
  jpegQuality: 0.92,
  filenamePrefix: 'our-event',
  cameraFacing: 'environment',
  exportBackground: '#101014',
  theme: {
    background: '#101014',
    surface: '#1c1c22',
    text: '#f5f5f7',
    mutedText: '#a1a1aa',
    accent: '#e0b64c',
    accentText: '#1a1408',
  },
};

/** Output aspect ratio, derived so it can never drift from the dimensions. */
export const outputAspectRatio = eventConfig.outputWidth / eventConfig.outputHeight;
