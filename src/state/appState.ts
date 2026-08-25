/**
 * Explicit guest-flow state model.
 *
 * Impossible combinations are prevented by making each state carry exactly the
 * data it needs. Do not reintroduce these as a bag of unrelated booleans.
 */
import type { WorkingImage } from '../lib/image/types.ts';
import type { ExportedImage } from '../lib/image/types.ts';
import type { Transform } from '../lib/image/types.ts';

export type AppErrorKind =
  'overlayLoadFailed' | 'decodeFailed' | 'unsupportedFile' | 'exportFailed' | 'shareFailed';

export type AppError = {
  kind: AppErrorKind;
  /** Guest-facing copy. Never include a filename or any photo data. */
  message: string;
  /** Whether the guest can retry the same action. */
  recoverable: boolean;
};

export type AppState =
  | { status: 'idle' }
  | { status: 'decoding' }
  | { status: 'editing'; image: WorkingImage; transform: Transform }
  | { status: 'preparingExport'; image: WorkingImage; transform: Transform }
  | { status: 'ready'; image: WorkingImage; transform: Transform; exported: ExportedImage }
  | { status: 'fallbackSave'; exported: ExportedImage }
  | { status: 'error'; error: AppError };

export type AppStatus = AppState['status'];
