import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App.tsx';
import { eventConfig } from './config/index.ts';

/**
 * Exercises App wired to the real useGuestFlow hook (no mocking), so this
 * only covers the initial idle/LandingScreen render — the overlay preload's
 * `new Image()` never fires load/error in jsdom (see tests/fixtures/
 * FIXTURES.md), so overlayReady never flips true here. Every other status
 * is covered in App.test.tsx against a mocked hook instead.
 */
describe('App shell (idle/LandingScreen, via the real hook)', () => {
  it('renders the event name and a page heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getByText(eventConfig.eventName)).toBeInTheDocument();
  });

  it('shows the instruction and privacy message', () => {
    render(<App />);
    expect(screen.getByText(eventConfig.instruction)).toBeInTheDocument();
    expect(screen.getByText(eventConfig.privacyMessage)).toBeInTheDocument();
  });
});
