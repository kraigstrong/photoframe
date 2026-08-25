import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DecodingScreen from './DecodingScreen.tsx';

describe('DecodingScreen', () => {
  it('shows a default message in a polite live region when none is given', () => {
    render(<DecodingScreen />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Preparing your photo…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows the given message', () => {
    render(<DecodingScreen message="Reading HEIC photo…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading HEIC photo…');
  });
});
