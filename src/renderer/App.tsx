import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useGameStore } from './store/gameStore';
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
  useAudio();

  useEffect(() => {
    void init();
  }, [init]);

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
