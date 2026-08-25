import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ErrorScreen from './ErrorScreen.tsx';
import type { AppError } from '../state/appState.ts';

describe('ErrorScreen', () => {
  it('shows the error message in an assertive live region', () => {
    const error: AppError = {
      kind: 'decodeFailed',
      message: "We couldn't open that photo.",
      recoverable: true,
    };
    render(<ErrorScreen error={error} onRetry={vi.fn()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("We couldn't open that photo.");
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });

  it('shows a "Try again" button that calls onRetry when the error is recoverable', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const error: AppError = {
      kind: 'exportFailed',
      message: 'Something went wrong.',
      recoverable: true,
    };
    render(<ErrorScreen error={error} onRetry={onRetry} />);

    const button = screen.getByRole('button', { name: 'Try again' });
    await user.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows no action when the error is not recoverable', () => {
    const error: AppError = { kind: 'overlayLoadFailed', message: 'Fatal.', recoverable: false };
    render(<ErrorScreen error={error} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
