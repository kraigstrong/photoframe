/**
 * Drives the guest-flow state machine (`AppState`, appState.ts) end to end:
 * overlay preload, decode, transform edits, debounced export regeneration,
 * share/fallback, and retry — using only `src/lib/image` (frozen) and
 * `src/config` (frozen). Owns every `release()` call so a `WorkingImage` or
 * `ExportedImage` is never left un-released, and every cancellation guard so
 * a superseded decode/export can never overwrite a newer one.
 *
 * `src/components/**` consumes this hook's return value; it must not
 * reimplement any of this orchestration itself.
 *
 * All action callbacks read current state via `stateRef` (kept in sync with
 * `state` every render) rather than closing over `state` directly, so a
 * callback handed to a component as a stable prop never acts on a stale
 * snapshot from whenever it was first created.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { eventConfig } from '../config/index.ts';
import { imageEngine } from '../lib/image/index.ts';
import type { ExportedImage, Transform, WorkingImage } from '../lib/image/types.ts';
import { shareService } from '../lib/share/index.ts';
import { currentPlatform, track } from '../lib/telemetry/index.ts';
import type { PhotoSource } from '../lib/telemetry/index.ts';
import type { AppError, AppErrorKind, AppState } from './appState.ts';

const EXPORT_DEBOUNCE_MS = 400;
/** How long the confirmation toast stays visible before self-clearing. */
const CONFIRMATION_DURATION_MS = 2500;

/** `eventConfig.overlays` reshaped for `EditingScreenProps` — computed once
 * since the config is a static, import-time constant for the app's whole
 * lifetime. */
const overlaysForPicker = eventConfig.overlays.map((overlay) => ({
  id: overlay.id,
  label: overlay.label,
  src: overlay.asset,
  thumbnail: overlay.thumbnail,
}));

/**
 * A brief, self-dismissing confirmation surfaced after an action this hook
 * can actually observe completing: `navigator.share()` resolving, or the
 * fallback Download button being clicked. There is no browser signal for
 * the manual "touch and hold to save" gesture, so that path stays silent —
 * a real platform limitation, not an oversight.
 *
 * Deliberately a single generic kind rather than distinguishing "shared"
 * from "saved": once the guest hands off to navigator.share()'s OS sheet,
 * there's no signal for which destination they picked in it (including
 * "Save Image"), so a label that claims to know would often be wrong.
 */
export type ShareConfirmation = 'done' | null;

const FRIENDLY_MESSAGES: Record<AppErrorKind, string> = {
  overlayLoadFailed: "We couldn't load the event frame. Check your connection and try again.",
  decodeFailed:
    "We couldn't open that photo. Try taking a new photo or choosing a JPEG, PNG, or HEIC photo supported by your phone.",
  unsupportedFile:
    "We couldn't open that photo. Try taking a new photo or choosing a JPEG, PNG, or HEIC photo supported by your phone.",
  exportFailed: "Something went wrong preparing your photo. Let's try that again.",
  shareFailed: "Something went wrong sharing your photo. Let's try that again.",
};

function makeError(kind: AppErrorKind): AppError {
  return { kind, message: FRIENDLY_MESSAGES[kind], recoverable: true };
}

type Action =
  | { type: 'OVERLAY_FAILED' }
  | { type: 'DECODE_START' }
  | { type: 'DECODE_SUCCESS'; image: WorkingImage; transform: Transform }
  | { type: 'DECODE_FAILED'; kind: 'decodeFailed' | 'unsupportedFile' }
  | { type: 'TRANSFORM_CHANGED'; transform: Transform }
  | { type: 'EXPORT_START' }
  | { type: 'EXPORT_SUCCESS'; exported: ExportedImage }
  | { type: 'EXPORT_FAILED' }
  | { type: 'CHANGE_PHOTO' }
  | { type: 'SHARE_UNAVAILABLE_OR_FAILED' }
  | {
      type: 'BACK_TO_EDITING';
      image: WorkingImage;
      transform: Transform;
      exported: ExportedImage;
    }
  | { type: 'RETRY_TO_IDLE' }
  | { type: 'RETRY_TO_EDITING'; image: WorkingImage; transform: Transform };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'OVERLAY_FAILED':
      return { status: 'error', error: makeError('overlayLoadFailed') };
    case 'DECODE_START':
      return { status: 'decoding' };
    case 'DECODE_SUCCESS':
      return { status: 'editing', image: action.image, transform: action.transform };
    case 'DECODE_FAILED':
      return { status: 'error', error: makeError(action.kind) };
    case 'TRANSFORM_CHANGED':
      return state.status === 'editing' ||
        state.status === 'preparingExport' ||
        state.status === 'ready'
        ? { status: 'editing', image: state.image, transform: action.transform }
        : state;
    case 'EXPORT_START':
      return state.status === 'editing'
        ? { status: 'preparingExport', image: state.image, transform: state.transform }
        : state;
    case 'EXPORT_SUCCESS':
      return state.status === 'preparingExport'
        ? {
            status: 'ready',
            image: state.image,
            transform: state.transform,
            exported: action.exported,
          }
        : state;
    case 'EXPORT_FAILED':
      return { status: 'error', error: makeError('exportFailed') };
    case 'CHANGE_PHOTO':
      return { status: 'idle' };
    case 'SHARE_UNAVAILABLE_OR_FAILED':
      return state.status === 'ready'
        ? { status: 'fallbackSave', exported: state.exported }
        : state;
    case 'BACK_TO_EDITING':
      // Restores 'ready' directly with the still-valid export from before
      // the failed/unsupported share attempt (same image+transform, never
      // released) — not 'editing', which would leave Save/Share disabled
      // indefinitely until the guest happened to touch the transform.
      return {
        status: 'ready',
        image: action.image,
        transform: action.transform,
        exported: action.exported,
      };
    case 'RETRY_TO_IDLE':
      return { status: 'idle' };
    case 'RETRY_TO_EDITING':
      return { status: 'editing', image: action.image, transform: action.transform };
    default:
      return state;
  }
}

export type UseGuestFlowResult = {
  state: AppState;
  overlayReady: boolean;
  /** Decorative sample photo for LandingScreen's preview frame. */
  previewPhoto: string;
  /** Every configured frame design, for the editing-screen picker. */
  overlays: { id: string; label: string; src: string; thumbnail: string }[];
  selectedOverlayIndex: number;
  selectOverlay: (index: number) => void;
  /** Records which photo-source button the guest pressed, for telemetry.
   *  Wired to `LandingScreenProps.onSourceClick`. */
  sourceClick: (source: 'camera' | 'library') => void;
  eventName: string;
  privacyMessage: string;
  telemetryMessage: string;
  cameraFacing: 'user' | 'environment';
  confirmation: ShareConfirmation;
  selectFile: (file: File) => void;
  updateTransform: (next: Transform) => void;
  resetPosition: () => void;
  changePhoto: () => void;
  saveOrShare: () => void;
  retry: () => void;
  download: () => void;
  backToEditing: () => void;
  tryShareAgain: () => void;
};

export function useGuestFlow(): UseGuestFlowResult {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' } as AppState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [overlayReady, setOverlayReady] = useState(false);
  const overlayImagesRef = useRef<(CanvasImageSource | null)[]>(
    eventConfig.overlays.map(() => null),
  );

  const [selectedOverlayIndex, setSelectedOverlayIndex] = useState(0);
  const selectedOverlayIndexRef = useRef(selectedOverlayIndex);
  useLayoutEffect(() => {
    selectedOverlayIndexRef.current = selectedOverlayIndex;
  }, [selectedOverlayIndex]);

  /** The stable config id (never the index or label) of the frame currently
   * selected, for telemetry. */
  const currentFrameId = useCallback(
    (): string => eventConfig.overlays[selectedOverlayIndexRef.current]?.id ?? 'unknown',
    [],
  );

  // Fires once per page load, guarded so React StrictMode's development
  // double-invoke of effects can't double-count a single real session.
  const appOpenTrackedRef = useRef(false);
  useEffect(() => {
    if (appOpenTrackedRef.current) {
      return;
    }
    appOpenTrackedRef.current = true;
    track({
      ev: 'app_open',
      platform: currentPlatform(),
      canShareFiles: shareService.detect() === 'files',
    });
  }, []);

  // Last photo-source button the guest pressed. Not reset after a load
  // completes: a later photo_load with no preceding click (not normally
  // reachable) should report the last known source rather than lying about
  // having none.
  const lastSourceRef = useRef<PhotoSource | null>(null);
  const sourceClick = useCallback((source: PhotoSource) => {
    lastSourceRef.current = source;
    track({ ev: 'source_click', source });
  }, []);

  const [confirmation, setConfirmation] = useState<ShareConfirmation>(null);
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVisibilityListenerRef = useRef<(() => void) | null>(null);

  const showConfirmation = useCallback(() => {
    if (confirmationTimerRef.current) {
      clearTimeout(confirmationTimerRef.current);
    }
    setConfirmation('done');
    confirmationTimerRef.current = setTimeout(() => {
      confirmationTimerRef.current = null;
      setConfirmation(null);
    }, CONFIRMATION_DURATION_MS);
  }, []);

  // Sharing and the OS-level save/download prompt both hand off to native
  // UI (the share sheet, a "Save Image" confirmation, the Messages compose
  // screen, etc.) that covers this page while the guest is on it — and
  // `navigator.share()`/the download resolve at hand-off time, not when the
  // guest actually returns. Showing the confirmation immediately would run
  // its whole auto-dismiss clock while the guest can't possibly see it.
  // Wait for the page to actually be visible again first.
  const showConfirmationWhenVisible = useCallback(() => {
    if (pendingVisibilityListenerRef.current) {
      document.removeEventListener('visibilitychange', pendingVisibilityListenerRef.current);
      pendingVisibilityListenerRef.current = null;
    }
    if (document.visibilityState === 'visible') {
      showConfirmation();
      return;
    }
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      document.removeEventListener('visibilitychange', onVisible);
      pendingVisibilityListenerRef.current = null;
      showConfirmation();
    };
    pendingVisibilityListenerRef.current = onVisible;
    document.addEventListener('visibilitychange', onVisible);
  }, [showConfirmation]);

  // Kept outside AppState (whose 'error' variant intentionally carries no
  // recovery payload) purely so exportFailed/shareFailed retry can restore
  // the guest's in-progress crop instead of forcing a full reselect.
  const lastEditableRef = useRef<{ image: WorkingImage; transform: Transform } | null>(null);

  // Guards against a second concurrent navigator.share() call. A native
  // share sheet is normally modal and blocks the page while open on the
  // target browsers, but nothing guarantees that on every browser, and
  // EditingScreen's own re-enable timer is a fixed cooldown rather than
  // tied to actual completion. Calling navigator.share() again while one
  // is already pending rejects with InvalidStateError on most browsers,
  // which attemptShare would otherwise misclassify as a genuine failure
  // and bounce the guest to the fallback screen out from under a share
  // that may still be in progress.
  const sharePendingRef = useRef(false);

  const decodeOpIdRef = useRef(0);
  const decodeAbortRef = useRef<AbortController | null>(null);
  const exportOpIdRef = useRef(0);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverlays = useCallback(() => {
    overlayImagesRef.current = eventConfig.overlays.map(() => null);
    let loadedCount = 0;
    let failed = false;
    eventConfig.overlays.forEach((overlay, index) => {
      const img = new Image();
      img.addEventListener(
        'load',
        () => {
          if (failed) {
            return;
          }
          overlayImagesRef.current[index] = img;
          loadedCount += 1;
          if (loadedCount === eventConfig.overlays.length) {
            setOverlayReady(true);
          }
        },
        { once: true },
      );
      img.addEventListener(
        'error',
        () => {
          if (failed) {
            return;
          }
          failed = true;
          dispatch({ type: 'OVERLAY_FAILED' });
          track({ ev: 'app_error', kind: 'overlay_load' });
        },
        { once: true },
      );
      img.src = overlay.asset;
    });
  }, []);

  useEffect(() => {
    loadOverlays();
    // Overlay lifetime spans the whole app session; nothing to release here
    // (plain same-origin <img>s, not object URLs).
  }, [loadOverlays]);

  const runExport = useCallback((image: WorkingImage, transform: Transform) => {
    const overlay = overlayImagesRef.current[selectedOverlayIndexRef.current];
    if (!overlay) {
      return;
    }
    const opId = ++exportOpIdRef.current;
    dispatch({ type: 'EXPORT_START' });
    imageEngine.export(image, transform, overlay).then(
      (exported) => {
        if (exportOpIdRef.current !== opId) {
          // A newer edit superseded this export before it resolved.
          exported.release();
          return;
        }
        // lastEditableRef is kept up to date from decode success and every
        // transform change (see selectFile/updateTransform), not from here
        // — otherwise the very first export attempt failing would leave it
        // null, with no way to retry without a full reselect.
        dispatch({ type: 'EXPORT_SUCCESS', exported });
      },
      () => {
        if (exportOpIdRef.current !== opId) {
          // A superseded export; not a real failure worth reporting.
          return;
        }
        dispatch({ type: 'EXPORT_FAILED' });
        track({ ev: 'app_error', kind: 'export_build' });
      },
    );
  }, []);

  const scheduleExport = useCallback(
    (image: WorkingImage, transform: Transform) => {
      // Invalidate any export already in flight so its late arrival is
      // ignored by runExport's own opId check.
      exportOpIdRef.current += 1;
      if (exportTimerRef.current) {
        clearTimeout(exportTimerRef.current);
      }
      exportTimerRef.current = setTimeout(() => {
        exportTimerRef.current = null;
        runExport(image, transform);
      }, EXPORT_DEBOUNCE_MS);
    },
    [runExport],
  );

  const selectFile = useCallback(
    (file: File) => {
      const prior = stateRef.current;
      // A newer selection always wins over whatever the guest picked before,
      // decoded or not.
      decodeAbortRef.current?.abort();
      if (exportTimerRef.current) {
        clearTimeout(exportTimerRef.current);
        exportTimerRef.current = null;
      }
      exportOpIdRef.current += 1;

      if (prior.status === 'editing' || prior.status === 'preparingExport') {
        prior.image.release();
      } else if (prior.status === 'ready') {
        prior.image.release();
        prior.exported.release();
      }
      lastEditableRef.current = null;

      const opId = ++decodeOpIdRef.current;
      const controller = new AbortController();
      decodeAbortRef.current = controller;

      dispatch({ type: 'DECODE_START' });
      imageEngine.decode(file, { signal: controller.signal }).then(
        (image) => {
          if (decodeOpIdRef.current !== opId) {
            image.release();
            return;
          }
          const transform = imageEngine.coverFit(
            image,
            eventConfig.outputWidth,
            eventConfig.outputHeight,
          );
          lastEditableRef.current = { image, transform };
          dispatch({ type: 'DECODE_SUCCESS', image, transform });
          track({ ev: 'photo_load', source: lastSourceRef.current, ok: true });
          scheduleExport(image, transform);
        },
        (err: unknown) => {
          if (decodeOpIdRef.current !== opId) {
            return;
          }
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Superseded by a newer selection; that selection already owns
            // the state transition. Not a load failure — no telemetry.
            return;
          }
          dispatch({ type: 'DECODE_FAILED', kind: 'decodeFailed' });
          track({ ev: 'photo_load', source: lastSourceRef.current, ok: false });
        },
      );
    },
    [scheduleExport],
  );

  const updateTransform = useCallback(
    (next: Transform) => {
      const current = stateRef.current;
      if (
        current.status !== 'editing' &&
        current.status !== 'preparingExport' &&
        current.status !== 'ready'
      ) {
        return;
      }
      const image = current.image;
      if (current.status === 'ready') {
        current.exported.release();
      }
      lastEditableRef.current = { image, transform: next };
      dispatch({ type: 'TRANSFORM_CHANGED', transform: next });
      scheduleExport(image, next);
    },
    [scheduleExport],
  );

  const resetPosition = useCallback(() => {
    const current = stateRef.current;
    if (
      current.status !== 'editing' &&
      current.status !== 'preparingExport' &&
      current.status !== 'ready'
    ) {
      return;
    }
    const baseline = imageEngine.coverFit(
      current.image,
      eventConfig.outputWidth,
      eventConfig.outputHeight,
    );
    updateTransform(baseline);
  }, [updateTransform]);

  const selectOverlay = useCallback(
    (index: number) => {
      if (index === selectedOverlayIndexRef.current) {
        return;
      }
      const frame = eventConfig.overlays[index]?.id;
      if (frame) {
        track({ ev: 'frame_select', frame });
      }
      selectedOverlayIndexRef.current = index;
      setSelectedOverlayIndex(index);

      const current = stateRef.current;
      if (
        current.status !== 'editing' &&
        current.status !== 'preparingExport' &&
        current.status !== 'ready'
      ) {
        // Nothing exported yet to re-bake; the next export (once decoding
        // finishes) will already pick up overlayImagesRef via
        // selectedOverlayIndexRef.
        return;
      }
      const { image, transform } = current;
      if (current.status === 'ready') {
        current.exported.release();
      }
      // Bounces 'ready' back to 'editing' with the same transform, purely to
      // invalidate the stale export (same trick TRANSFORM_CHANGED already
      // supports) — Save/Share disables and shows "Preparing photo…" again
      // until the re-bake with the newly selected overlay completes.
      dispatch({ type: 'TRANSFORM_CHANGED', transform });
      // Unlike a drag/pinch (a rapid stream of updates worth debouncing), a
      // picker tap is a single discrete action — run the re-export
      // immediately instead of adding EXPORT_DEBOUNCE_MS of pure wait on top
      // of the already-instant live preview swap.
      if (exportTimerRef.current) {
        clearTimeout(exportTimerRef.current);
        exportTimerRef.current = null;
      }
      runExport(image, transform);
    },
    [runExport],
  );

  const changePhoto = useCallback(() => {
    const current = stateRef.current;
    decodeAbortRef.current?.abort();
    if (exportTimerRef.current) {
      clearTimeout(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    decodeOpIdRef.current += 1;
    exportOpIdRef.current += 1;

    if (current.status === 'editing' || current.status === 'preparingExport') {
      current.image.release();
    } else if (current.status === 'ready') {
      current.image.release();
      current.exported.release();
    } else if (current.status === 'fallbackSave') {
      current.exported.release();
    }
    lastEditableRef.current = null;
    dispatch({ type: 'CHANGE_PHOTO' });
  }, []);

  const attemptShare = useCallback(
    (exported: ExportedImage) => {
      if (sharePendingRef.current) {
        // A share is already in flight; ignore the extra tap rather than
        // firing a second concurrent navigator.share() call.
        return;
      }
      const frame = currentFrameId();
      track({ ev: 'export_attempt', via: 'share', frame });
      sharePendingRef.current = true;
      shareService.share(exported).then((outcome) => {
        sharePendingRef.current = false;
        switch (outcome.result) {
          case 'shared':
            track({ ev: 'export_result', via: 'share', outcome: 'shared', frame });
            showConfirmationWhenVisible();
            return;
          case 'cancelled':
            // A normal outcome, not a failure — no confirmation, no error.
            track({ ev: 'export_result', via: 'share', outcome: 'cancelled', frame });
            return;
          case 'unavailable':
            track({ ev: 'export_result', via: 'share', outcome: 'unavailable', frame });
            dispatch({ type: 'SHARE_UNAVAILABLE_OR_FAILED' });
            return;
          case 'failed':
            track({
              ev: 'export_result',
              via: 'share',
              outcome: 'failed',
              frame,
              err: outcome.errorName,
            });
            dispatch({ type: 'SHARE_UNAVAILABLE_OR_FAILED' });
            return;
          default: {
            // Compile-time exhaustiveness: adding a ShareOutcome variant
            // without handling it here fails the type check.
            const exhaustiveCheck: never = outcome;
            void exhaustiveCheck;
            // At runtime, fall through to the fallback save screen rather
            // than throwing. A throw inside this .then() would become an
            // unhandled rejection and — worse — leave the guest parked on
            // 'ready' with the share sheet closed and nothing dispatched,
            // an unrecoverable dead end. The fallback screen still hands
            // them their finished photo. No telemetry here: an outcome
            // variant this build doesn't know about isn't one of the
            // ExportOutcome values track() can express anyway.
            dispatch({ type: 'SHARE_UNAVAILABLE_OR_FAILED' });
            return;
          }
        }
      });
    },
    [showConfirmationWhenVisible, currentFrameId],
  );

  const saveOrShare = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'ready') {
      return;
    }
    attemptShare(current.exported);
  }, [attemptShare]);

  const tryShareAgain = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'fallbackSave') {
      return;
    }
    attemptShare(current.exported);
  }, [attemptShare]);

  const download = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'fallbackSave') {
      return;
    }
    track({ ev: 'export_attempt', via: 'download', frame: currentFrameId() });
    shareService.saveFallback(current.exported);
    // Deliberately no export_result for the download path: link.click()
    // gives no observable success/failure signal to report. Do not add one.
    showConfirmationWhenVisible();
  }, [showConfirmationWhenVisible, currentFrameId]);

  const backToEditing = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'fallbackSave') {
      return;
    }
    const editable = lastEditableRef.current;
    if (!editable) {
      // No recoverable crop context (shouldn't normally happen) — safest
      // valid fallback is to let the guest pick again.
      dispatch({ type: 'CHANGE_PHOTO' });
      return;
    }
    dispatch({
      type: 'BACK_TO_EDITING',
      image: editable.image,
      transform: editable.transform,
      exported: current.exported,
    });
  }, []);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'error') {
      return;
    }
    if (current.error.kind === 'overlayLoadFailed') {
      loadOverlays();
      dispatch({ type: 'RETRY_TO_IDLE' });
      return;
    }
    if (current.error.kind === 'exportFailed' || current.error.kind === 'shareFailed') {
      const editable = lastEditableRef.current;
      if (editable) {
        dispatch({
          type: 'RETRY_TO_EDITING',
          image: editable.image,
          transform: editable.transform,
        });
        scheduleExport(editable.image, editable.transform);
        return;
      }
    }
    dispatch({ type: 'RETRY_TO_IDLE' });
  }, [loadOverlays, scheduleExport]);

  // Release whatever the guest currently holds if the whole app unmounts
  // (e.g. hot reload in dev). In production this only ever mounts once.
  useEffect(() => {
    return () => {
      decodeAbortRef.current?.abort();
      if (exportTimerRef.current) {
        clearTimeout(exportTimerRef.current);
      }
      if (confirmationTimerRef.current) {
        clearTimeout(confirmationTimerRef.current);
      }
      if (pendingVisibilityListenerRef.current) {
        document.removeEventListener('visibilitychange', pendingVisibilityListenerRef.current);
      }
    };
  }, []);

  return {
    state,
    overlayReady,
    previewPhoto: eventConfig.previewPhoto,
    overlays: overlaysForPicker,
    selectedOverlayIndex,
    selectOverlay,
    sourceClick,
    eventName: eventConfig.eventName,
    privacyMessage: eventConfig.privacyMessage,
    telemetryMessage: eventConfig.telemetryMessage,
    cameraFacing: eventConfig.cameraFacing,
    confirmation,
    selectFile,
    updateTransform,
    resetPosition,
    changePhoto,
    saveOrShare,
    retry,
    download,
    backToEditing,
    tryShareAgain,
  };
}
