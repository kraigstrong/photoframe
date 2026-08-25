import { useEffect } from 'react';
import DecodingScreen from './components/DecodingScreen.tsx';
import EditingScreen from './components/EditingScreen.tsx';
import ErrorScreen from './components/ErrorScreen.tsx';
import FallbackScreen from './components/FallbackScreen.tsx';
import LandingScreen from './components/LandingScreen.tsx';
import { eventConfig } from './config/index.ts';
import { useGuestFlow } from './state/useGuestFlow.ts';

/**
 * Application shell: owns the document title, the theme tokens derived from
 * the event configuration, and renders the guest-facing screen for the
 * current `AppState` status. All guest-flow orchestration lives in
 * `useGuestFlow`; this component only maps state to the matching
 * presentational component from `src/components/**`.
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

  const flow = useGuestFlow();
  const { state } = flow;

  switch (state.status) {
    case 'idle':
      return (
        <LandingScreen
          eventName={flow.eventName}
          instruction={flow.instruction}
          privacyMessage={flow.privacyMessage}
          overlaySrc={flow.overlaySrc}
          cameraFacing={flow.cameraFacing}
          overlayReady={flow.overlayReady}
          onSelectFile={flow.selectFile}
        />
      );

    case 'decoding':
      return <DecodingScreen />;

    case 'editing':
    case 'preparingExport':
      return (
        <EditingScreen
          eventName={flow.eventName}
          image={state.image}
          overlaySrc={flow.overlaySrc}
          outputWidth={eventConfig.outputWidth}
          outputHeight={eventConfig.outputHeight}
          transform={state.transform}
          onTransformChange={flow.updateTransform}
          onResetPosition={flow.resetPosition}
          onChangePhoto={flow.changePhoto}
          exportReady={false}
          onSaveOrShare={flow.saveOrShare}
          confirmation={flow.confirmation}
        />
      );

    case 'ready':
      return (
        <EditingScreen
          eventName={flow.eventName}
          image={state.image}
          overlaySrc={flow.overlaySrc}
          outputWidth={eventConfig.outputWidth}
          outputHeight={eventConfig.outputHeight}
          transform={state.transform}
          onTransformChange={flow.updateTransform}
          onResetPosition={flow.resetPosition}
          onChangePhoto={flow.changePhoto}
          exportReady
          onSaveOrShare={flow.saveOrShare}
          confirmation={flow.confirmation}
        />
      );

    case 'fallbackSave':
      return (
        <FallbackScreen
          exported={state.exported}
          onDownload={flow.download}
          onBackToEditing={flow.backToEditing}
          onTryShareAgain={flow.tryShareAgain}
          confirmation={flow.confirmation}
        />
      );

    case 'error':
      return <ErrorScreen error={state.error} onRetry={flow.retry} />;

    default: {
      const exhaustiveCheck: never = state;
      throw new Error(`Unhandled AppState status: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
