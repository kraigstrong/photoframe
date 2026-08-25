import type { ErrorScreenProps } from './types.ts';
import styles from './ErrorScreen.module.css';

/** Terminal or recoverable error state. Errors interrupt, so the message
 * region uses `aria-live="assertive"` rather than the "polite" loading copy. */
export default function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  return (
    <main className={styles.shell}>
      <p className={styles.message} role="alert" aria-live="assertive">
        {error.message}
      </p>
      {error.recoverable ? (
        <button type="button" className={styles.primaryButton} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </main>
  );
}
