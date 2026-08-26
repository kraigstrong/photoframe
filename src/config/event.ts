import type { EventConfig } from './types.ts';
import overlayAsset from '../assets/overlay-panther-prowl-2026.png';
// Placeholder recolors of the real design above, scaffolding the multi-overlay
// picker until additional real designs are ready. Swap these out the same
// way as the primary overlay — see the README's "Replacing the overlay".
import overlayAssetAlt from '../assets/overlay-panther-prowl-2026-alt.png';
import overlayAssetAlt2 from '../assets/overlay-panther-prowl-2026-alt-2.png';

/**
 * The single configured event for this deployment.
 *
 * To rebrand this app for a different event, edit this file and replace
 * `src/assets/overlay-placeholder.png`. See the README for overlay requirements.
 */
export const eventConfig: EventConfig = {
  eventName: 'Panther Prowl 2026',
  pageTitle: 'Panther Prowl 2026 — Photo Frame',
  instruction: 'We add the 2026 frame right here on your phone.',
  privacyMessage: 'Your photo stays on your phone. It is not uploaded.',
  overlays: [
    { id: 'panther-prowl-2026', label: 'Design 1', asset: overlayAsset },
    { id: 'panther-prowl-2026-alt', label: 'Design 2', asset: overlayAssetAlt },
    { id: 'panther-prowl-2026-alt-2', label: 'Design 3', asset: overlayAssetAlt2 },
  ],
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
