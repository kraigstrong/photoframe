import { useRef, type ChangeEvent } from 'react';
import type { LandingScreenProps } from './types.ts';
import styles from './LandingScreen.module.css';

/**
 * Entry screen: lets the guest take a new photo or choose an existing one.
 * Both actions are backed by hidden `<input type="file">` elements triggered
 * from real `<button>`s, so focus/keyboard semantics stay standard instead of
 * relying on a `<label>` wrapping an input.
 */
export default function LandingScreen({
  eventName,
  instruction,
  privacyMessage,
  cameraFacing,
  overlayReady,
  onSelectFile,
}: LandingScreenProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    // Reset the input value even when no file was picked so a future
    // selection of the same file still fires a change event.
    event.target.value = '';
    if (file) {
      onSelectFile(file);
    }
  }

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{eventName}</h1>
      <p className={styles.instruction}>{instruction}</p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={!overlayReady}
          onClick={() => cameraInputRef.current?.click()}
        >
          Take a photo
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture={cameraFacing}
          disabled={!overlayReady}
          onChange={handleFileChange}
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
        />

        <button
          type="button"
          className={styles.secondaryButton}
          disabled={!overlayReady}
          onClick={() => libraryInputRef.current?.click()}
        >
          Choose a photo
        </button>
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          disabled={!overlayReady}
          onChange={handleFileChange}
          className="visually-hidden"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      <p className={styles.privacy}>{privacyMessage}</p>
    </main>
  );
}
