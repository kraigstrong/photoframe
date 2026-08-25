import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FallbackScreen from './FallbackScreen.tsx';
import type { ExportedImage } from '../lib/image/types.ts';
import type { FallbackScreenProps } from './types.ts';

function makeExported(overrides: Partial<ExportedImage> = {}): ExportedImage {
  return {
    blob: new Blob(['fake'], { type: 'image/jpeg' }),
    objectUrl: 'blob:exported',
    filename: 'event-1.jpg',
    width: 1080,
    height: 1350,
    release: vi.fn(),
    ...overrides,
  };
}

function makeProps(overrides: Partial<FallbackScreenProps> = {}): FallbackScreenProps {
  return {
    exported: makeExported(),
    onDownload: vi.fn(),
    onBackToEditing: vi.fn(),
    onTryShareAgain: vi.fn(),
    confirmation: null,
    ...overrides,
  };
}

describe('FallbackScreen', () => {
  it('shows the exported image and the manual-save instructions', () => {
    render(<FallbackScreen {...makeProps()} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:exported');
    expect(
      screen.getByText('Touch and hold the image, then choose Save to Photos.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('If this doesn’t work, try opening this page in Safari or Chrome.'),
    ).toBeInTheDocument();
  });

  it('wires the Download button to onDownload', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    render(<FallbackScreen {...makeProps({ onDownload })} />);
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('wires "Try sharing again" to onTryShareAgain', async () => {
    const user = userEvent.setup();
    const onTryShareAgain = vi.fn();
    render(<FallbackScreen {...makeProps({ onTryShareAgain })} />);
    await user.click(screen.getByRole('button', { name: 'Try sharing again' }));
    expect(onTryShareAgain).toHaveBeenCalledTimes(1);
  });

  it('wires "Back to editing" to onBackToEditing', async () => {
    const user = userEvent.setup();
    const onBackToEditing = vi.fn();
    render(<FallbackScreen {...makeProps({ onBackToEditing })} />);
    await user.click(screen.getByRole('button', { name: 'Back to editing' }));
    expect(onBackToEditing).toHaveBeenCalledTimes(1);
  });

  it('shows a "Saved!" confirmation when confirmation is "saved"', () => {
    render(<FallbackScreen {...makeProps({ confirmation: 'saved' })} />);
    expect(screen.getByText('Saved!')).toBeInTheDocument();
  });

  it('shows a "Shared!" confirmation when confirmation is "shared" (e.g. after "Try sharing again" succeeds)', () => {
    render(<FallbackScreen {...makeProps({ confirmation: 'shared' })} />);
    expect(screen.getByText('Shared!')).toBeInTheDocument();
  });

  it('shows no confirmation text when confirmation is null', () => {
    render(<FallbackScreen {...makeProps({ confirmation: null })} />);
    expect(screen.queryByText('Shared!')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved!')).not.toBeInTheDocument();
  });
});
