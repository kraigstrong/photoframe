import type { FallbackScreenProps } from './types.ts';
import styles from './FallbackScreen.module.css';

/**
 * Shown when the Web Share API is unavailable or a share attempt failed.
 * Gives the guest a manual save path (long-press or the download button)
 * plus a way back to editing or to retry sharing.
 */
export default function FallbackScreen({
  exported,
  onDownload,
  onBackToEditing,
  onTryShareAgain,
}: FallbackScreenProps) {
  return (
    <main className={styles.shell}>
      <img
        className={styles.preview}
        src={exported.objectUrl}
        alt="Your finished photo, ready to save"
      />

      <p className={styles.instruction}>Touch and hold the image, then choose Save to Photos.</p>
      <p className={styles.hint}>
        If this doesn&rsquo;t work, try opening this page in Safari or Chrome.
      </p>

      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={onDownload}>
          Download
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onTryShareAgain}>
          Try sharing again
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onBackToEditing}>
          Back to editing
        </button>
      </div>
    </main>
  );
}
