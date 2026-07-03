import { memo } from 'react';
import { useGameStore } from '../store/gameStore';
import { multiplierFor, SP_MIN_ACTIVATE } from '../engine/TimingEngine';

/**
 * DOM overlay above the canvas: score, streak multiplier, rock meter and the
 * star power gauge. It only re-renders when a judgement or gauge sync lands,
 * never on animation frames.
 */
function HUD(): JSX.Element {
  const score = useGameStore((s) => s.score);
  const combo = useGameStore((s) => s.combo);
  const rockMeter = useGameStore((s) => s.rockMeter);
  const starPower = useGameStore((s) => s.starPower);
  const spActive = useGameStore((s) => s.spActive);
  const muted = useGameStore((s) => s.muted);
  const song = useGameStore((s) => s.song);

  const multiplier = multiplierFor(combo) * (spActive ? 2 : 1);
  const needleDeg = -90 + (Math.max(0, Math.min(100, rockMeter)) / 100) * 180;
  const spReady = starPower >= SP_MIN_ACTIVATE && !spActive;

  return (
    <div className="hud">
      <div className="hud-box hud-score">
        <span className="hud-label">SCORE</span>
        <span className="hud-value">{score.toLocaleString()}</span>
      </div>

      <div className="rock-meter">
        <div className="rock-dial">
          <div className="rock-needle" style={{ transform: `rotate(${needleDeg}deg)` }} />
        </div>
        <span className="hud-label">ROCK METER</span>
      </div>

      <div className={`hud-streak ${spActive ? 'sp-active' : ''}`}>
        <span className={`streak-mult mult-${multiplierFor(combo)}`}>×{multiplier}</span>
        <span className="streak-num">{combo} streak</span>
        <div className={`sp-bar ${spReady ? 'ready' : ''} ${spActive ? 'active' : ''}`}>
          <div className="sp-fill" style={{ width: `${Math.round(starPower * 100)}%` }} />
        </div>
        <span className="sp-hint">
          {spActive ? 'STAR POWER!' : spReady ? 'SPACE — star power ready' : 'star power'}
        </span>
      </div>

      {song && <div className="hud-song">{song.title}</div>}
      {muted && <div className="hud-muted">MUTED (M)</div>}
    </div>
  );
}

export default memo(HUD);
