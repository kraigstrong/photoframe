import { useEffect } from 'react';
import { eventConfig } from './config/index.ts';
import styles from './App.module.css';

/**
 * Application shell for milestone 0.
 *
 * The guest flow states are implemented in later milestones. This shell owns
 * the document title, the theme tokens derived from the event configuration,
 * and the landing layout that the guest UX work builds on.
 */
export default function App() {
  useEffect(() => {
    document.title = eventConfig.pageTitle;
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const { theme } = eventConfig;
    root.style.setProperty('--bg', theme.background);
    root.style.setProperty('--surface', theme.surface);
    root.style.setProperty('--text', theme.text);
    root.style.setProperty('--muted-text', theme.mutedText);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-text', theme.accentText);
  }, []);

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{eventConfig.eventName}</h1>
      <p className={styles.instruction}>{eventConfig.instruction}</p>
      <p className={styles.privacy}>{eventConfig.privacyMessage}</p>
    </main>
  );
}
