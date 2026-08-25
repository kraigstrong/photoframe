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
import type { AppError, AppErrorKind, AppState } from './appState.ts';

const EXPORT_DEBOUNCE_MS = 400;

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
  overlaySrc: string;
  eventName: string;
  instruction: string;
  privacyMessage: string;
  cameraFacing: 'user' | 'environment';
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
  const overlayImageRef = useRef<CanvasImageSource | null>(null);

  // Kept outside AppState (whose 'error' variant intentionally carries no
  // recovery payload) purely so exportFailed/shareFailed retry can restore
  // the guest's in-progress crop instead of forcing a full reselect.
  const lastEditableRef = useRef<{ image: WorkingImage; transform: Transform } | null>(null);

  const decodeOpIdRef = useRef(0);
  const decodeAbortRef = useRef<AbortController | null>(null);
  const exportOpIdRef = useRef(0);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverlay = useCallback(() => {
    const img = new Image();
    img.addEventListener(
      'load',
      () => {
        overlayImageRef.current = img;
        setOverlayReady(true);
      },
      { once: true },
    );
    img.addEventListener(
      'error',
      () => {
        dispatch({ type: 'OVERLAY_FAILED' });
      },
      { once: true },
    );
    img.src = eventConfig.overlayAsset;
  }, []);

  useEffect(() => {
    loadOverlay();
    // Overlay lifetime spans the whole app session; nothing to release here
    // (a plain same-origin <img>, not an object URL).
  }, [loadOverlay]);

  const runExport = useCallback((image: WorkingImage, transform: Transform) => {
    const overlay = overlayImageRef.current;
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
          return;
        }
        dispatch({ type: 'EXPORT_FAILED' });
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
          scheduleExport(image, transform);
        },
        (err: unknown) => {
          if (decodeOpIdRef.current !== opId) {
            return;
          }
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Superseded by a newer selection; that selection already owns
            // the state transition.
            return;
          }
          dispatch({ type: 'DECODE_FAILED', kind: 'decodeFailed' });
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

  const attemptShare = useCallback((exported: ExportedImage) => {
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files: File[] }) => Promise<void>;
    };
    const file = new File([exported.blob], exported.filename, { type: exported.blob.type });

    if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
      nav
        .share({ files: [file] })
        .then(() => {
          // Success: stay put. The guest can share again or change photo.
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Guest cancelled the share sheet — a normal outcome, not a failure.
            return;
          }
          dispatch({ type: 'SHARE_UNAVAILABLE_OR_FAILED' });
        });
    } else {
      dispatch({ type: 'SHARE_UNAVAILABLE_OR_FAILED' });
    }
  }, []);

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
    const link = document.createElement('a');
    link.href = current.exported.objectUrl;
    link.download = current.exported.filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, []);

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
      loadOverlay();
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
  }, [loadOverlay, scheduleExport]);

  // Release whatever the guest currently holds if the whole app unmounts
  // (e.g. hot reload in dev). In production this only ever mounts once.
  useEffect(() => {
    return () => {
      decodeAbortRef.current?.abort();
      if (exportTimerRef.current) {
        clearTimeout(exportTimerRef.current);
      }
    };
  }, []);

  return {
    state,
    overlayReady,
    overlaySrc: eventConfig.overlayAsset,
    eventName: eventConfig.eventName,
    instruction: eventConfig.instruction,
    privacyMessage: eventConfig.privacyMessage,
    cameraFacing: eventConfig.cameraFacing,
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
