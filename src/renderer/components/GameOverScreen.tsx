import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { audio } from '../hooks/useAudio';

export default function GameOverScreen(): JSX.Element | null {
  const result = useGameStore((s) => s.result);
  const song = useGameStore((s) => s.song);
  const restartGame = useGameStore((s) => s.restartGame);
  const quitToMenu = useGameStore((s) => s.quitToMenu);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'KeyR') restartGame();
      else if (e.code === 'Escape') quitToMenu();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restartGame, quitToMenu]);

  if (!result || !song) return null;

  return (
    <div className="screen gameover-screen">
      {result.failed ? (
        <>
          <h2 className="gameover-title failed">SONG FAILED</h2>
          <p className="gameover-song">
            {song.title} — booed off at {Math.round(result.completion * 100)}%
          </p>
        </>
      ) : (
        <>
          <h2 className="gameover-title">YOU ROCK</h2>
          <p className="gameover-song">{song.title}</p>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <span key={star} className={star <= result.stars ? 'star on' : 'star'}>
                ★
              </span>
            ))}
          </div>
        </>
      )}

      {result.newRecord && <div className="badge record">NEW RECORD</div>}
      {result.fullCombo && <div className="badge fc">FULL COMBO</div>}

      <div className="final-score">{result.score.toLocaleString()}</div>

      <div className="result-grid">
        <div>
          <span className="hud-label">NOTES HIT</span>
          <span className="hud-value">
            {result.notesHit}/{result.notesTotal}
          </span>
        </div>
        <div>
          <span className="hud-label">ACCURACY</span>
          <span className="hud-value">{result.accuracy.toFixed(1)}%</span>
        </div>
        <div>
          <span className="hud-label">BEST STREAK</span>
          <span className="hud-value">{result.maxCombo}</span>
        </div>
        <div>
          <span className="hud-label">OVERSTRUMS</span>
          <span className="hud-value">{result.overstrums}</span>
        </div>
      </div>

      <div className="menu-buttons">
        <button
          type="button"
          onClick={() => {
            audio.uiClick();
            restartGame();
          }}
        >
          Play Again (R)
        </button>
        <button
          type="button"
          onClick={() => {
            audio.uiClick();
            quitToMenu();
          }}
        >
          Main Menu (ESC)
        </button>
      </div>
    </div>
  );
}
