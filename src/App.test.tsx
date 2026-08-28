import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App.tsx';
import { eventConfig } from './config/index.ts';
import type { UseGuestFlowResult } from './state/useGuestFlow.ts';
import type { ExportedImage, WorkingImage } from './lib/image/types.ts';

/**
 * App.tsx's own job is the AppState -> screen-component mapping; the guest
 * flow logic itself is already covered by state/useGuestFlow.test.ts. Mock
 * the hook here so each status can be driven directly and in isolation.
 */
vi.mock('./state/useGuestFlow.ts', () => ({
  useGuestFlow: vi.fn(),
}));

const { useGuestFlow } = await import('./state/useGuestFlow.ts');
const mockedUseGuestFlow = vi.mocked(useGuestFlow);

function baseFlow(overrides: Partial<UseGuestFlowResult>): UseGuestFlowResult {
  return {
    state: { status: 'idle' },
    overlayReady: true,
    previewPhoto: '/preview.jpg',
    overlays: [
      { id: 'default', label: 'Design 1', src: '/overlay.png', thumbnail: '/overlay-thumb.png' },
    ],
    selectedOverlayIndex: 0,
    selectOverlay: vi.fn(),
    sourceClick: vi.fn(),
    eventName: eventConfig.eventName,
    telemetryMessage: 'We count anonymous taps.',
    privacyMessage: eventConfig.privacyMessage,
    cameraFacing: eventConfig.cameraFacing,
    confirmation: null,
    selectFile: vi.fn(),
    updateTransform: vi.fn(),
    resetPosition: vi.fn(),
    changePhoto: vi.fn(),
    saveOrShare: vi.fn(),
    retry: vi.fn(),
    download: vi.fn(),
    backToEditing: vi.fn(),
    tryShareAgain: vi.fn(),
    ...overrides,
  };
}

const IMAGE: WorkingImage = { src: 'blob:image', width: 600, height: 800, release: vi.fn() };
const EXPORTED: ExportedImage = {
  blob: new Blob(['x'], { type: 'image/jpeg' }),
  objectUrl: 'blob:exported',
  filename: 'event-1.jpg',
  width: 1080,
  height: 1350,
  release: vi.fn(),
};

describe('App: renders the screen matching each AppState status', () => {
  it('idle -> LandingScreen', () => {
    mockedUseGuestFlow.mockReturnValue(baseFlow({ state: { status: 'idle' } }));
    render(<App />);
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeInTheDocument();
  });

  it('decoding -> DecodingScreen', () => {
    mockedUseGuestFlow.mockReturnValue(baseFlow({ state: { status: 'decoding' } }));
    render(<App />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('editing -> EditingScreen with exportReady false', () => {
    mockedUseGuestFlow.mockReturnValue(
      baseFlow({ state: { status: 'editing', image: IMAGE, transform: { x: 0, y: 0, scale: 1 } } }),
    );
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save or share' })).toBeDisabled();
  });

  it('preparingExport -> EditingScreen with exportReady false', () => {
    mockedUseGuestFlow.mockReturnValue(
      baseFlow({
        state: { status: 'preparingExport', image: IMAGE, transform: { x: 0, y: 0, scale: 1 } },
      }),
    );
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save or share' })).toBeDisabled();
  });

  it('ready -> EditingScreen with exportReady true', () => {
    mockedUseGuestFlow.mockReturnValue(
      baseFlow({
        state: {
          status: 'ready',
          image: IMAGE,
          transform: { x: 0, y: 0, scale: 1 },
          exported: EXPORTED,
        },
      }),
    );
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save or share' })).toBeEnabled();
  });

  it('fallbackSave -> FallbackScreen', () => {
    mockedUseGuestFlow.mockReturnValue(
      baseFlow({ state: { status: 'fallbackSave', exported: EXPORTED } }),
    );
    render(<App />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('error -> ErrorScreen', () => {
    mockedUseGuestFlow.mockReturnValue(
      baseFlow({
        state: {
          status: 'error',
          error: { kind: 'decodeFailed', message: 'nope', recoverable: true },
        },
      }),
    );
    render(<App />);
    expect(screen.getByText('nope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
