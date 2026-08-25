import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Toast from './Toast.tsx';

describe('Toast', () => {
  it('renders the given message as a polite status announcement', () => {
    render(<Toast message="Shared!" />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Shared!');
    expect(toast).toHaveAttribute('aria-live', 'polite');
  });
});
