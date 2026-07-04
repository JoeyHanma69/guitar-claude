import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { useGameStore } from './store/gameStore';
import { SONGS } from './engine/NoteGenerator';
import StartScreen from './components/StartScreen';
import GameCanvas from './components/GameCanvas';
import HUD from './components/HUD';
import GameOverScreen from './components/GameOverScreen';
import { useAudio } from './hooks/useAudio';
import './styles/App.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render crash', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    const { children } = this.props;
    if (error) {
      return (
        <div className="screen crash-screen">
          <h2>Something broke.</h2>
          <pre>{error.message}</pre>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return children;
  }
}

export default function App(): JSX.Element {
  const phase = useGameStore((s) => s.phase);
  const loaded = useGameStore((s) => s.loaded);
  const init = useGameStore((s) => s.init);
  const [fatal, setFatal] = useState<string | null>(null);
  useAudio();

  useEffect(() => {
    void init();
  }, [init]);

  // Deep link: ?song=<id> jumps straight into a built-in song.
  useEffect(() => {
    if (!loaded) return;
    const id = new URLSearchParams(window.location.search).get('song');
    if (!id) return;
    const def = SONGS.find((s) => s.id === id);
    if (def && useGameStore.getState().phase === 'menu') {
      useGameStore.getState().startGame(def);
    }
  }, [loaded]);

  // Errors thrown outside React's render (game loop, async import work)
  // bypass the error boundary — surface them instead of a dead black screen.
  useEffect(() => {
    const onError = (e: ErrorEvent): void => setFatal(e.message || 'Unknown error');
    const onRejection = (e: PromiseRejectionEvent): void => {
      setFatal(e.reason instanceof Error ? e.reason.message : String(e.reason));
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  if (fatal) {
    return (
      <div className="screen crash-screen">
        <h2>Something broke.</h2>
        <pre>{fatal}</pre>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (!loaded) {
    return <div className="screen boot">LOADING…</div>;
  }

  return (
    <ErrorBoundary>
      <div className="app">
        {phase === 'menu' && <StartScreen />}
        {phase === 'playing' && (
          <>
            <GameCanvas />
            <HUD />
          </>
        )}
        {phase === 'gameover' && <GameOverScreen />}
      </div>
    </ErrorBoundary>
  );
}
