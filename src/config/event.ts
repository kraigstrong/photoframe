import type { EventConfig } from './types.ts';
import overlayAsset from '../assets/overlay-panther-prowl-2026.png';
import overlayAssetAlt from '../assets/overlay-panther-prowl-2026-alt.png';
import overlayAssetAlt2 from '../assets/overlay-panther-prowl-2026-alt-2.png';
import overlayAssetAlt3 from '../assets/overlay-panther-prowl-2026-alt-3.png';
import overlayAssetAlt4 from '../assets/overlay-panther-prowl-2026-alt-4.png';
import overlayThumb from '../assets/overlay-panther-prowl-2026-thumb.png';
import overlayThumbAlt from '../assets/overlay-panther-prowl-2026-alt-thumb.png';
import overlayThumbAlt2 from '../assets/overlay-panther-prowl-2026-alt-2-thumb.png';
import overlayThumbAlt3 from '../assets/overlay-panther-prowl-2026-alt-3-thumb.png';
import overlayThumbAlt4 from '../assets/overlay-panther-prowl-2026-alt-4-thumb.png';
import previewPhoto from '../assets/landing-preview-photo.jpg';

/**
 * The single configured event for this deployment.
 *
 * To rebrand this app for a different event, edit this file and replace
 * `src/assets/overlay-placeholder.png`. See the README for overlay requirements.
 */
export const eventConfig: EventConfig = {
  eventName: 'Panther Prowl 2026',
  pageTitle: 'Panther Prowl 2026 — Photo Frame',
  privacyMessage: 'Your photo stays on your phone. It is not uploaded.',
  telemetryMessage: 'We count anonymous taps. Never your photo.',
  overlays: [
    { id: 'panther-prowl-2026', label: 'Design 1', asset: overlayAsset, thumbnail: overlayThumb },
    {
      id: 'panther-prowl-2026-alt',
      label: 'Design 2',
      asset: overlayAssetAlt,
      thumbnail: overlayThumbAlt,
    },
    {
      id: 'panther-prowl-2026-alt-2',
      label: 'Design 3',
      asset: overlayAssetAlt2,
      thumbnail: overlayThumbAlt2,
    },
    {
      id: 'panther-prowl-2026-alt-3',
      label: 'Design 4',
      asset: overlayAssetAlt3,
      thumbnail: overlayThumbAlt3,
    },
    {
      id: 'panther-prowl-2026-alt-4',
      label: 'Design 5',
      asset: overlayAssetAlt4,
      thumbnail: overlayThumbAlt4,
    },
  ],
  previewPhoto,
  outputWidth: 1080,
  outputHeight: 1350,
  jpegQuality: 0.92,
  filenamePrefix: 'panther-prowl-2026',
  cameraFacing: 'environment',
  exportBackground: '#FBFAF6',
  theme: {
    background: '#FBFAF6',
    surface: '#FFFFFF',
    text: '#17201A',
    mutedText: '#5F6B62',
    accent: '#1E5B33',
    accentText: '#FFFFFF',
  },
};

/** Output aspect ratio, derived so it can never drift from the dimensions. */
export const outputAspectRatio = eventConfig.outputWidth / eventConfig.outputHeight;
