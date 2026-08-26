import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { applyZoom, clamp, coverScale } from '../lib/image/index.ts';
import type { Transform } from '../lib/image/types.ts';
import Toast from './Toast.tsx';
import type { EditingScreenProps } from './types.ts';
import styles from './EditingScreen.module.css';

/** Output-frame pixels nudged per arrow-key press while the preview is focused. */
const KEYBOARD_NUDGE_STEP = 20;

/** Used only before the first real container measurement lands. */
const FALLBACK_CONTAINER_WIDTH_PX = 360;

/** How long the Save/Share button stays disabled after a tap, to absorb
 * accidental double-taps without coordinating with the hook. */
const SHARE_COOLDOWN_MS = 1000;

/** How long `exportReady` must stay false before the button/helper text
 * actually switch to their "preparing" look. A re-export that resolves
 * faster than this (e.g. after switching overlays) never visibly flashes
 * the button — the guest just sees the frame swap and nothing else. */
const PREPARING_INDICATOR_DELAY_MS = 150;

type PointerPoint = { x: number; y: number };

type PanState = {
  mode: 'pan';
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  /** The transform this drag is accumulating on top of, kept locally so
   * rapid pointer events never wait on a prop round-trip through the
   * parent's (possibly debounced) state update. */
  workingTransform: Transform;
};

type PinchState = {
  mode: 'pinch';
  pointerIds: readonly [number, number];
  /** Client-pixel distance between the two pointers when the pinch began. */
  startDistance: number;
  /** The transform in effect when the pinch began; zoom is always computed
   * fresh from this fixed base (same "anchor to frame center" contract as
   * applyZoom/the slider), never accumulated incrementally. */
  baseTransform: Transform;
};

type GestureState = PanState | PinchState;

function distanceBetween(a: PointerPoint, b: PointerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The photo + overlay editing surface: drag/keyboard pan, slider zoom, and
 * the reset/change-photo/save-or-share actions. See src/components/types.ts
 * for the frozen prop contract and the positioning algorithm this
 * implements.
 */
export default function EditingScreen({
  eventName,
  image,
  overlays,
  selectedOverlayIndex,
  onSelectOverlay,
  outputWidth,
  outputHeight,
  transform,
  onTransformChange,
  onResetPosition,
  onChangePhoto,
  exportReady,
  onSaveOrShare,
  confirmation,
}: EditingScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidthPx, setContainerWidthPx] = useState(FALLBACK_CONTAINER_WIDTH_PX);
  const gestureRef = useRef<GestureState | null>(null);
  const activePointersRef = useRef<Map<number, PointerPoint>>(new Map());
  /** Mirrors the `transform` prop, but updated eagerly on every commit so a
   * pinch-to-pan handoff (one finger lifts mid-pinch) can start the pan from
   * the just-applied transform instead of the not-yet-re-rendered prop. */
  const latestTransformRef = useRef(transform);

  const [isShareCoolingDown, setIsShareCoolingDown] = useState(false);
  const shareCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when a tap lands during the brief window where the button doesn't
   * look disabled yet (see showPreparing below) but the export isn't
   * actually ready — honored as soon as it is, instead of silently
   * discarding a tap the guest can plainly see they made. */
  const pendingShareRef = useRef(false);

  const performShare = useCallback(() => {
    setIsShareCoolingDown(true);
    onSaveOrShare();
    shareCooldownTimerRef.current = setTimeout(() => {
      setIsShareCoolingDown(false);
    }, SHARE_COOLDOWN_MS);
  }, [onSaveOrShare]);

  /** Debounced view of `!exportReady`, so a fast re-export never flashes the
   * button/helper text into their "preparing" look and back. The actual
   * click guard in handleSaveOrShare still reads the real `exportReady`
   * prop, so this is purely cosmetic — it never lets a stale export through. */
  const [showPreparing, setShowPreparing] = useState(!exportReady);

  useEffect(() => {
    if (exportReady) {
      return;
    }
    const timer = setTimeout(() => {
      setShowPreparing(true);
    }, PREPARING_INDICATOR_DELAY_MS);
    // Runs when exportReady flips back to true (before the "ready" effect
    // instance below no-ops) or on unmount — either way, the pending timer
    // is scrapped and any stale "preparing" look is cleared.
    return () => {
      clearTimeout(timer);
      setShowPreparing(false);
    };
  }, [exportReady]);

  useEffect(() => {
    if (exportReady && pendingShareRef.current) {
      pendingShareRef.current = false;
      performShare();
    }
  }, [exportReady, performShare]);

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

  useLayoutEffect(() => {
    latestTransformRef.current = transform;
  }, [transform]);

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

  function commitTransform(next: Transform): void {
    latestTransformRef.current = next;
    onTransformChange(next);
  }

  function startPan(pointerId: number, point: PointerPoint): void {
    gestureRef.current = {
      mode: 'pan',
      pointerId,
      lastClientX: point.x,
      lastClientY: point.y,
      workingTransform: latestTransformRef.current,
    };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointersRef.current.size === 2) {
      const [idA, idB] = [...activePointersRef.current.keys()] as [number, number];
      const pointA = activePointersRef.current.get(idA);
      const pointB = activePointersRef.current.get(idB);
      if (pointA && pointB) {
        gestureRef.current = {
          mode: 'pinch',
          pointerIds: [idA, idB],
          startDistance: distanceBetween(pointA, pointB),
          baseTransform: latestTransformRef.current,
        };
      }
      return;
    }

    if (activePointersRef.current.size === 1) {
      startPan(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    // A third simultaneous pointer is ignored: the active pan/pinch gesture
    // (already anchored to the first two) continues unaffected.
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    if (gesture.mode === 'pinch') {
      const [idA, idB] = gesture.pointerIds;
      if (event.pointerId !== idA && event.pointerId !== idB) {
        return;
      }
      const pointA = activePointersRef.current.get(idA);
      const pointB = activePointersRef.current.get(idB);
      if (!pointA || !pointB || gesture.startDistance === 0) {
        return;
      }
      const ratio = distanceBetween(pointA, pointB) / gesture.startDistance;
      const nextScale = gesture.baseTransform.scale * ratio;
      commitTransform(
        applyZoom(gesture.baseTransform, nextScale, image, outputWidth, outputHeight),
      );
      return;
    }

    if (gesture.pointerId !== event.pointerId) {
      return;
    }
    const deltaCssX = event.clientX - gesture.lastClientX;
    const deltaCssY = event.clientY - gesture.lastClientY;
    if (deltaCssX === 0 && deltaCssY === 0) {
      return;
    }
    const deltaFrameX = deltaCssX / cssScaleFactor;
    const deltaFrameY = deltaCssY / cssScaleFactor;
    const next = applyFrameDelta(gesture.workingTransform, deltaFrameX, deltaFrameY);
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;
    gesture.workingTransform = next;
    commitTransform(next);
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const hadPointer = activePointersRef.current.delete(event.pointerId);
    if (!hadPointer) {
      return;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const gesture = gestureRef.current;
    if (!gesture) {
      return;
    }

    if (gesture.mode === 'pan') {
      if (gesture.pointerId === event.pointerId) {
        gestureRef.current = null;
      }
      return;
    }

    const [idA, idB] = gesture.pointerIds;
    if (event.pointerId !== idA && event.pointerId !== idB) {
      return;
    }
    // One finger of the pinch lifted. If the other is still down, hand off
    // to a pan anchored at its current position instead of ending the
    // gesture, so repositioning can continue with the remaining finger.
    const remainingId = idA === event.pointerId ? idB : idA;
    const remainingPoint = activePointersRef.current.get(remainingId);
    if (remainingPoint) {
      startPan(remainingId, remainingPoint);
    } else {
      gestureRef.current = null;
    }
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
    commitTransform(applyFrameDelta(transform, deltaFrameX, deltaFrameY));
  }

  function handleSaveOrShare(): void {
    if (isShareCoolingDown) {
      return;
    }
    if (!exportReady) {
      pendingShareRef.current = true;
      return;
    }
    performShare();
  }

  return (
    <main className={styles.shell}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onChangePhoto}>
          Back
        </button>
        <span className={styles.headerLabel}>{eventName}</span>
        <button type="button" className={styles.resetButton} onClick={onResetPosition}>
          Reset
        </button>
      </div>

      <div
        ref={containerRef}
        className={styles.preview}
        style={{ aspectRatio: `${outputWidth} / ${outputHeight}` }}
        tabIndex={0}
        role="group"
        aria-label="Drag to reposition the photo. Use arrow keys to move it."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
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
        <img
          src={overlays[selectedOverlayIndex]!.src}
          alt=""
          aria-hidden="true"
          className={styles.overlay}
        />
      </div>

      <p className={styles.hint}>Drag to reposition, pinch to zoom</p>

      {overlays.length > 1 ? (
        <div className={styles.overlayPicker} role="radiogroup" aria-label="Choose a frame design">
          {overlays.map((overlay, index) => (
            <button
              key={overlay.id}
              type="button"
              role="radio"
              aria-checked={index === selectedOverlayIndex}
              aria-label={overlay.label}
              className={styles.overlayOption}
              data-selected={index === selectedOverlayIndex || undefined}
              onClick={() => onSelectOverlay(index)}
            >
              <img src={overlay.thumbnail} alt="" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.shareRow}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={showPreparing || isShareCoolingDown}
          onClick={handleSaveOrShare}
        >
          Save or share
        </button>
        <p className={styles.helperMessage} aria-live="polite">
          {showPreparing
            ? 'Preparing photo…'
            : 'Choose Save Image to keep it, or pick an app to share it.'}
        </p>
      </div>
      {confirmation ? <Toast message="All set!" /> : null}
    </main>
  );
}
