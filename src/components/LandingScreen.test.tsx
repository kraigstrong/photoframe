import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LandingScreen from './LandingScreen.tsx';
import type { LandingScreenProps } from './types.ts';

function makeProps(overrides: Partial<LandingScreenProps> = {}): LandingScreenProps {
  return {
    eventName: 'Ada & Sam’s Wedding',
    privacyMessage: 'Photos never leave your device.',
    previewPhoto: '/preview.jpg',
    cameraFacing: 'environment',
    overlayReady: true,
    onSelectFile: vi.fn(),
    onSourceClick: vi.fn(),
    ...overrides,
  };
}

describe('LandingScreen', () => {
  it('renders event name and privacy message', () => {
    render(<LandingScreen {...makeProps()} />);
    expect(screen.getByRole('heading')).toBeInTheDocument();
    expect(screen.getByText('Ada & Sam’s Wedding')).toBeInTheDocument();
    expect(screen.getByText('Photos never leave your device.')).toBeInTheDocument();
  });

  it('gives the camera input the accept and capture attributes', () => {
    render(<LandingScreen {...makeProps({ cameraFacing: 'user' })} />);
    const inputs = document.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(2);
    const cameraInput = Array.from(inputs).find((el) => el.hasAttribute('capture'));
    expect(cameraInput).toBeDefined();
    expect(cameraInput).toHaveAttribute('accept', 'image/*');
    expect(cameraInput).toHaveAttribute('capture', 'user');
  });

  it('disables both buttons and inputs while the overlay is not ready', () => {
    render(<LandingScreen {...makeProps({ overlayReady: false })} />);
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose from camera roll' })).toBeDisabled();
    document.querySelectorAll('input[type="file"]').forEach((input) => {
      expect(input).toBeDisabled();
    });
  });

  it('enables the buttons once the overlay is ready', () => {
    render(<LandingScreen {...makeProps({ overlayReady: true })} />);
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose from camera roll' })).toBeEnabled();
  });

  it('calls onSelectFile with the chosen file and resets the input value', async () => {
    const user = userEvent.setup();
    const onSelectFile = vi.fn();
    render(<LandingScreen {...makeProps({ onSelectFile })} />);

    const file = new File(['fake-bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const libraryInput = document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;

    await user.upload(libraryInput, file);

    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(onSelectFile).toHaveBeenCalledWith(file);
    expect(libraryInput.value).toBe('');
  });

  it('clicking the visible buttons triggers their backing hidden input', async () => {
    const user = userEvent.setup();
    render(<LandingScreen {...makeProps()} />);

    const inputs = document.querySelectorAll('input[type="file"]');
    const clickSpies = Array.from(inputs).map((input) =>
      vi.spyOn(input as HTMLInputElement, 'click'),
    );

    await user.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(clickSpies[0]).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Choose from camera roll' }));
    expect(clickSpies[1]).toHaveBeenCalledTimes(1);
  });

  it('reports source intent via onSourceClick before opening the native picker', async () => {
    const user = userEvent.setup();
    const onSourceClick = vi.fn();
    render(<LandingScreen {...makeProps({ onSourceClick })} />);

    await user.click(screen.getByRole('button', { name: 'Take a photo' }));
    expect(onSourceClick).toHaveBeenCalledWith('camera');

    await user.click(screen.getByRole('button', { name: 'Choose from camera roll' }));
    expect(onSourceClick).toHaveBeenCalledWith('library');

    expect(onSourceClick).toHaveBeenCalledTimes(2);
  });
});
