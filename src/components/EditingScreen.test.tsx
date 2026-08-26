import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EditingScreen from './EditingScreen.tsx';
import { applyZoom } from '../lib/image/index.ts';
import type { Transform, WorkingImage } from '../lib/image/types.ts';
import type { EditingScreenProps } from './types.ts';

// jsdom implements neither pointer capture nor ResizeObserver. The component
// guards ResizeObserver's absence itself (falls back to the one-off
// getBoundingClientRect measurement), but pointer capture methods need a
// stub here so the drag handlers under test don't throw.
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const CONTAINER_WIDTH_PX = 108; // outputWidth / 10, for a round cssScaleFactor of 0.1
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1350;

const IMAGE: WorkingImage = {
  src: 'blob:working',
  width: 600,
  height: 800,
  release: vi.fn(),
};

// baseScale = max(1080/600, 1350/800) = 1.8

function makeProps(overrides: Partial<EditingScreenProps> = {}): EditingScreenProps {
  return {
    eventName: 'Ada & Sam’s Wedding',
    image: IMAGE,
    overlays: [
      { id: 'default', label: 'Design 1', src: '/overlay.png', thumbnail: '/overlay-thumb.png' },
    ],
    selectedOverlayIndex: 0,
    onSelectOverlay: vi.fn(),
    outputWidth: OUTPUT_WIDTH,
    outputHeight: OUTPUT_HEIGHT,
    transform: { x: -200, y: -300, scale: 1.5 },
    onTransformChange: vi.fn(),
    onResetPosition: vi.fn(),
    onChangePhoto: vi.fn(),
    exportReady: true,
    onSaveOrShare: vi.fn(),
    confirmation: null,
    ...overrides,
  };
}

function renderWithMeasuredContainer(props: EditingScreenProps) {
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: CONTAINER_WIDTH_PX,
    height: 135,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  const result = render(<EditingScreen {...props} />);
  return { ...result, rectSpy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EditingScreen', () => {
  it('renders the photo and a decorative, non-transformed overlay on top', () => {
    renderWithMeasuredContainer(makeProps());
    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(2);
    const overlay = images[1] as HTMLImageElement;
    expect(overlay).toHaveAttribute('src', '/overlay.png');
    expect(overlay).toHaveAttribute('aria-hidden', 'true');
    expect(overlay.style.transform).toBe('');
  });

  it('positions the photo per the cover-fit + transform algorithm', () => {
    renderWithMeasuredContainer(makeProps());
    const images = document.querySelectorAll('img');
    const photo = images[0] as HTMLImageElement;
    // cssScaleFactor = 108 / 1080 = 0.1; baseScale = 1.8
    // renderedWidth = 600 * 1.8 * 1.5 * 0.1 = 162
    // renderedHeight = 800 * 1.8 * 1.5 * 0.1 = 216
    // cssX = -200 * 0.1 = -20; cssY = -300 * 0.1 = -30
    expect(photo.style.width).toBe('162px');
    expect(photo.style.height).toBe('216px');
    expect(photo.style.transform).toBe('translate(-20px, -30px)');
  });

  it('exposes an accessible, focusable drag region', () => {
    renderWithMeasuredContainer(makeProps());
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('reports a clamped, dragged transform on pointer move', () => {
    const onTransformChange = vi.fn();
    renderWithMeasuredContainer(makeProps({ onTransformChange }));
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });

    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 105, clientY: 103 });

    // deltaCss (5, 3) / cssScaleFactor 0.1 = deltaFrame (50, 30)
    // next x = -200 + 50 = -150 (within [-540, 0], unclamped)
    // next y = -300 + 30 = -270 (within [-810, 0], unclamped)
    expect(onTransformChange).toHaveBeenCalledTimes(1);
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -150, y: -270, scale: 1.5 });

    fireEvent.pointerMove(region, { pointerId: 1, clientX: 110, clientY: 106 });
    // Second move compounds on the first move's working transform, not the
    // (still stale, debounced) transform prop: -150 + 50 = -100, -270 + 30 = -240
    expect(onTransformChange).toHaveBeenCalledTimes(2);
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -100, y: -240, scale: 1.5 });

    fireEvent.pointerUp(region, { pointerId: 1, clientX: 110, clientY: 106 });
  });

  it('reports the applyZoom result when two pointers pinch apart', () => {
    const onTransformChange = vi.fn();
    const transform: Transform = { x: -200, y: -300, scale: 1.5 };
    renderWithMeasuredContainer(makeProps({ onTransformChange, transform }));
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });

    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(region, { pointerId: 2, clientX: 100, clientY: 300 });
    // Starting distance is 100. Spreading to 200 apart doubles the distance,
    // so the pinch should report double the starting scale.
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 100, clientY: 400 });

    const expected = applyZoom(transform, 3, IMAGE, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    expect(onTransformChange).toHaveBeenCalledTimes(1);
    expect(onTransformChange).toHaveBeenCalledWith(expected);

    fireEvent.pointerUp(region, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerUp(region, { pointerId: 2, clientX: 100, clientY: 400 });
  });

  it('hands off to a pan with the remaining finger when a pinch loses one pointer', () => {
    const onTransformChange = vi.fn();
    const transform: Transform = { x: -200, y: -300, scale: 1.5 };
    renderWithMeasuredContainer(makeProps({ onTransformChange, transform }));
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });

    fireEvent.pointerDown(region, { pointerId: 1, clientX: 100, clientY: 200 });
    fireEvent.pointerDown(region, { pointerId: 2, clientX: 100, clientY: 300 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 100, clientY: 200 });

    // Pointer 2 is still down; dragging it now should pan, not zoom.
    fireEvent.pointerMove(region, { pointerId: 2, clientX: 105, clientY: 303 });

    // deltaCss (5, 3) / cssScaleFactor 0.1 = deltaFrame (50, 30)
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -150, y: -270, scale: 1.5 });

    fireEvent.pointerUp(region, { pointerId: 2, clientX: 105, clientY: 303 });
  });

  it('clamps a drag that would reveal an empty edge', () => {
    const onTransformChange = vi.fn();
    renderWithMeasuredContainer(makeProps({ onTransformChange }));
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });

    fireEvent.pointerDown(region, { pointerId: 1, clientX: 0, clientY: 0 });
    // Huge rightward/downward drag: deltaCss (5000, 5000) / 0.1 = deltaFrame (50000, 50000)
    fireEvent.pointerMove(region, { pointerId: 1, clientX: 5000, clientY: 5000 });

    // x range is [-540, 0], y range is [-810, 0]; both saturate at 0.
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: 0, y: 0, scale: 1.5 });
  });

  it('nudges the transform with arrow keys through the same clamp path', async () => {
    const user = userEvent.setup();
    const onTransformChange = vi.fn();
    renderWithMeasuredContainer(
      makeProps({ onTransformChange, transform: { x: -200, y: -300, scale: 1.5 } }),
    );
    const region = screen.getByRole('group', {
      name: 'Drag to reposition the photo. Use arrow keys to move it.',
    });
    region.focus();

    await user.keyboard('{ArrowRight}');
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -180, y: -300, scale: 1.5 });

    await user.keyboard('{ArrowDown}');
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -200, y: -280, scale: 1.5 });

    await user.keyboard('{ArrowLeft}');
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -220, y: -300, scale: 1.5 });

    await user.keyboard('{ArrowUp}');
    expect(onTransformChange).toHaveBeenLastCalledWith({ x: -200, y: -320, scale: 1.5 });
  });

  it('calls onResetPosition and onChangePhoto from the header buttons', async () => {
    const user = userEvent.setup();
    const onResetPosition = vi.fn();
    const onChangePhoto = vi.fn();
    renderWithMeasuredContainer(makeProps({ onResetPosition, onChangePhoto }));

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onResetPosition).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onChangePhoto).toHaveBeenCalledTimes(1);
  });

  it('does not render an overlay picker when only one design is configured', () => {
    renderWithMeasuredContainer(makeProps());
    expect(
      screen.queryByRole('radiogroup', { name: 'Choose a frame design' }),
    ).not.toBeInTheDocument();
  });

  it('renders one picker option per overlay, reflects the selected one, and reports taps', async () => {
    const user = userEvent.setup();
    const onSelectOverlay = vi.fn();
    renderWithMeasuredContainer(
      makeProps({
        overlays: [
          { id: 'a', label: 'Design 1', src: '/overlay-a.png', thumbnail: '/overlay-a-thumb.png' },
          { id: 'b', label: 'Design 2', src: '/overlay-b.png', thumbnail: '/overlay-b-thumb.png' },
          { id: 'c', label: 'Design 3', src: '/overlay-c.png', thumbnail: '/overlay-c-thumb.png' },
        ],
        selectedOverlayIndex: 1,
        onSelectOverlay,
      }),
    );

    const picker = screen.getByRole('radiogroup', { name: 'Choose a frame design' });
    const options = within(picker).getAllByRole('radio');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-checked', 'false');
    expect(options[1]).toHaveAttribute('aria-checked', 'true');
    expect(options[2]).toHaveAttribute('aria-checked', 'false');

    await user.click(options[2]!);
    expect(onSelectOverlay).toHaveBeenCalledTimes(1);
    expect(onSelectOverlay).toHaveBeenCalledWith(2);
  });

  it('disables Save/Share and shows a preparing message while export is not ready', () => {
    renderWithMeasuredContainer(makeProps({ exportReady: false }));
    expect(screen.getByRole('button', { name: 'Save or share' })).toBeDisabled();
    expect(screen.getByText('Preparing photo…')).toBeInTheDocument();
  });

  it('does not flash the preparing look when export becomes ready again quickly (e.g. switching overlays)', () => {
    vi.useFakeTimers();
    const { rerender } = renderWithMeasuredContainer(makeProps({ exportReady: true }));

    rerender(<EditingScreen {...makeProps({ exportReady: false })} />);
    // Resolves well within PREPARING_INDICATOR_DELAY_MS, as a fast overlay
    // re-export does — the button/helper text should never have flashed.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    rerender(<EditingScreen {...makeProps({ exportReady: true })} />);

    expect(screen.getByRole('button', { name: 'Save or share' })).not.toBeDisabled();
    expect(screen.queryByText('Preparing photo…')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('button', { name: 'Save or share' })).not.toBeDisabled();

    vi.useRealTimers();
  });

  it('does show the preparing look once export stays unready past the grace delay', () => {
    vi.useFakeTimers();
    const { rerender } = renderWithMeasuredContainer(makeProps({ exportReady: true }));

    rerender(<EditingScreen {...makeProps({ exportReady: false })} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByRole('button', { name: 'Save or share' })).toBeDisabled();
    expect(screen.getByText('Preparing photo…')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('honors a Save/Share tap that lands during the grace window once the export catches up', () => {
    vi.useFakeTimers();
    const onSaveOrShare = vi.fn();
    const { rerender } = renderWithMeasuredContainer(
      makeProps({ onSaveOrShare, exportReady: true }),
    );

    rerender(<EditingScreen {...makeProps({ onSaveOrShare, exportReady: false })} />);
    // Still within PREPARING_INDICATOR_DELAY_MS, so the button doesn't look
    // disabled yet — but the export genuinely isn't ready.
    const button = screen.getByRole('button', { name: 'Save or share' });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(onSaveOrShare).not.toHaveBeenCalled();

    rerender(<EditingScreen {...makeProps({ onSaveOrShare, exportReady: true })} />);
    expect(onSaveOrShare).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('calls onSaveOrShare once per click and debounces rapid double-taps', () => {
    vi.useFakeTimers();
    const onSaveOrShare = vi.fn();
    renderWithMeasuredContainer(makeProps({ onSaveOrShare, exportReady: true }));

    const button = screen.getByRole('button', { name: 'Save or share' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSaveOrShare).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(button).not.toBeDisabled();

    vi.useRealTimers();
  });

  it('shows an "All set!" confirmation when confirmation is "done"', () => {
    renderWithMeasuredContainer(makeProps({ confirmation: 'done' }));
    expect(screen.getByText('All set!')).toBeInTheDocument();
  });

  it('shows no confirmation text when confirmation is null', () => {
    renderWithMeasuredContainer(makeProps({ confirmation: null }));
    expect(screen.queryByText('All set!')).not.toBeInTheDocument();
  });
});
