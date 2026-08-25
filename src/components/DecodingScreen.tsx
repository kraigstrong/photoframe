import type { DecodingScreenProps } from './types.ts';
import styles from './DecodingScreen.module.css';

const DEFAULT_MESSAGE = 'Preparing your photo…';

/** Small loading state shown while a selected photo is being decoded. */
export default function DecodingScreen({ message }: DecodingScreenProps) {
  return (
    <main className={styles.shell}>
      <div className={styles.spinner} aria-hidden="true" />
      <p className={styles.message} role="status" aria-live="polite">
        {message ?? DEFAULT_MESSAGE}
      </p>
    </main>
  );
}
