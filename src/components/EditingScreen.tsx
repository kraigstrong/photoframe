import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  applyZoom,
  clamp,
  coverScale,
  MAX_RELATIVE_ZOOM,
  MIN_RELATIVE_ZOOM,
} from '../lib/image/index.ts';
import type { Transform } from '../lib/image/types.ts';
import type { EditingScreenProps } from './types.ts';
import styles from './EditingScreen.module.css';

/** Output-frame pixels nudged per arrow-key press while the preview is focused. */
const KEYBOARD_NUDGE_STEP = 20;

/** Used only before the first real container measurement lands. */
const FALLBACK_CONTAINER_WIDTH_PX = 360;

/** How long the Save/Share button stays disabled after a tap, to absorb
 * accidental double-taps without coordinating with the hook. */
const SHARE_COOLDOWN_MS = 1000;

type DragState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  /** The transform this drag is accumulating on top of, kept locally so
   * rapid pointer events never wait on a prop round-trip through the
   * parent's (possibly debounced) state update. */
  workingTransform: Transform;
};

/**
 * The photo + overlay editing surface: drag/keyboard pan, slider zoom, and
 * the reset/change-photo/save-or-share actions. See src/components/types.ts
 * for the frozen prop contract and the positioning algorithm this
 * implements.
 */
export default function EditingScreen({
  image,
  overlaySrc,
  outputWidth,
  outputHeight,
  transform,
  onTransformChange,
  onResetPosition,
  onChangePhoto,
  exportReady,
  onSaveOrShare,
}: EditingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidthPx, setContainerWidthPx] = useState(FALLBACK_CONTAINER_WIDTH_PX);
  const dragStateRef = useRef<DragState | null>(null);

  const [isShareCoolingDown, setIsShareCoolingDown] = useState(false);
  const shareCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      setContainerWidthPx(rect.width);
    }
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0) {
        setContainerWidthPx(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    return () => {
      if (shareCooldownTimerRef.current) {
        clearTimeout(shareCooldownTimerRef.current);
      }
    };
  }, []);

  const cssScaleFactor = containerWidthPx / outputWidth;
  const baseScale = coverScale(image, outputWidth, outputHeight);
  const renderedWidthPx = image.width * baseScale * transform.scale * cssScaleFactor;
  const renderedHeightPx = image.height * baseScale * transform.scale * cssScaleFactor;
  const cssX = transform.x * cssScaleFactor;
  const cssY = transform.y * cssScaleFactor;

  function applyFrameDelta(base: Transform, deltaFrameX: number, deltaFrameY: number): Transform {
    return clamp(
      { ...base, x: base.x + deltaFrameX, y: base.y + deltaFrameY },
      image,
      outputWidth,
      outputHeight,
    );
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      // `transform` reflects the latest committed prop as of this render;
      // handlePointerDown is a fresh closure each render, so this is never
      // stale by the time the guest actually starts a drag.
      workingTransform: transform,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaCssX = event.clientX - drag.lastClientX;
    const deltaCssY = event.clientY - drag.lastClientY;
    if (deltaCssX === 0 && deltaCssY === 0) {
      return;
    }
    const deltaFrameX = deltaCssX / cssScaleFactor;
    const deltaFrameY = deltaCssY / cssScaleFactor;
    const next = applyFrameDelta(drag.workingTransform, deltaFrameX, deltaFrameY);
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;
    drag.workingTransform = next;
    onTransformChange(next);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    let deltaFrameX = 0;
    let deltaFrameY = 0;
    switch (event.key) {
      case 'ArrowUp':
        deltaFrameY = -KEYBOARD_NUDGE_STEP;
        break;
      case 'ArrowDown':
        deltaFrameY = KEYBOARD_NUDGE_STEP;
        break;
      case 'ArrowLeft':
        deltaFrameX = -KEYBOARD_NUDGE_STEP;
        break;
      case 'ArrowRight':
        deltaFrameX = KEYBOARD_NUDGE_STEP;
        break;
      default:
        return;
    }
    event.preventDefault();
    onTransformChange(applyFrameDelta(transform, deltaFrameX, deltaFrameY));
  }

  function handleZoomChange(event: ChangeEvent<HTMLInputElement>): void {
    const nextScale = Number(event.target.value);
    onTransformChange(applyZoom(transform, nextScale, image, outputWidth, outputHeight));
  }

  function handleSaveOrShare(): void {
    if (!exportReady || isShareCoolingDown) {
      return;
    }
    setIsShareCoolingDown(true);
    onSaveOrShare();
    shareCooldownTimerRef.current = setTimeout(() => {
      setIsShareCoolingDown(false);
    }, SHARE_COOLDOWN_MS);
  }

  return (
    <main className={styles.shell}>
      <div
        ref={containerRef}
        className={styles.preview}
        style={{ aspectRatio: `${outputWidth} / ${outputHeight}` }}
        tabIndex={0}
        role="group"
        aria-label="Drag to reposition the photo. Use arrow keys to move it."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <img
          src={image.src}
          alt=""
          draggable={false}
          className={styles.photo}
          style={{
            width: `${renderedWidthPx}px`,
            height: `${renderedHeightPx}px`,
            transform: `translate(${cssX}px, ${cssY}px)`,
          }}
        />
        <img src={overlaySrc} alt="" aria-hidden="true" className={styles.overlay} />
      </div>

      <p className={styles.hint}>Drag to reposition</p>

      <div className={styles.zoomRow}>
        <label htmlFor="editing-zoom-slider" className={styles.zoomLabel}>
          Zoom
        </label>
        <input
          id="editing-zoom-slider"
          type="range"
          min={MIN_RELATIVE_ZOOM}
          max={MAX_RELATIVE_ZOOM}
          step={0.01}
          value={transform.scale}
          aria-valuetext={`Zoom ${transform.scale.toFixed(2)}x`}
          onChange={handleZoomChange}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.secondaryButton} onClick={onResetPosition}>
          Reset position
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onChangePhoto}>
          Change photo
        </button>
      </div>

      <div className={styles.shareRow}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!exportReady || isShareCoolingDown}
          onClick={handleSaveOrShare}
        >
          Save or share
        </button>
        {exportReady ? null : (
          <p className={styles.preparingMessage} aria-live="polite">
            Preparing photo…
          </p>
        )}
      </div>
    </main>
  );
}
