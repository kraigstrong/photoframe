import styles from './Toast.module.css';

export type ToastProps = {
  message: string;
};

/**
 * A brief, floating, centered confirmation — not inline text near whatever
 * button triggered it. `position: fixed` centers it on the viewport
 * regardless of where it's rendered in the tree; `pointer-events: none`
 * keeps it from blocking taps on whatever's underneath while it's visible.
 */
export default function Toast({ message }: ToastProps) {
  return (
    <p className={styles.toast} role="status" aria-live="polite">
      {message}
    </p>
  );
}
