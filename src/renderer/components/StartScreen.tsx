import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { SONGS } from '../engine/NoteGenerator';
import { analyzeFile } from '../engine/AudioImport';
import {
  deleteImportedSong,
  listImportedSongs,
  loadImportedSong,
  saveImportedSong,
  type ImportedSongMeta,
} from '../library';
import { NOTE_SPEEDS, DEFAULT_SETTINGS, keyLabel } from '../constants';
import { audio } from '../hooks/useAudio';

const DIFFICULTY_CLASS: Record<string, string> = {
  easy: 'diff-easy',
  medium: 'diff-medium',
  hard: 'diff-hard',
};

export default function StartScreen(): JSX.Element {
  const settings = useGameStore((s) => s.settings);
  const highScores = useGameStore((s) => s.highScores);
  const startGame = useGameStore((s) => s.startGame);
  const updateSettings = useGameStore((s) => s.updateSettings);

  const [panel, setPanel] = useState<'none' | 'settings' | 'help'>('none');
  const [remapLane, setRemapLane] = useState<number | null>(null);
  const [remapNote, setRemapNote] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [library, setLibrary] = useState<ImportedSongMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listImportedSongs()
      .then(setLibrary)
      .catch((err) => console.error('failed to load song library', err));
  }, []);

  const handleImport = async (file: File): Promise<void> => {
    setImporting(true);
    setImportError('');
    try {
      const { song, bytes } = await analyzeFile(file);
      try {
        await saveImportedSong(song, bytes);
        setLibrary(await listImportedSongs());
      } catch (err) {
        // Playable even if saving failed (e.g. storage quota).
        console.error('failed to save imported song', err);
      }
      startGame(song);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const playImported = async (id: string): Promise<void> => {
    setImporting(true);
    setImportError('');
    try {
      startGame(await loadImportedSong(id));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not load that song.');
    } finally {
      setImporting(false);
    }
  };

  const removeImported = async (id: string): Promise<void> => {
    try {
      await deleteImportedSong(id);
      setLibrary(await listImportedSongs());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not delete that song.');
    }
  };

  // Key-capture mode for rebinding a lane.
  useEffect(() => {
    if (remapLane === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      if (e.code === 'Escape') {
        setRemapLane(null);
        return;
      }
      const bindings = [...useGameStore.getState().settings.keyBindings];
      const conflict = bindings.indexOf(e.code);
      if (conflict !== -1 && conflict !== remapLane) {
        // Swap with the conflicting lane instead of leaving a dead binding.
        bindings[conflict] = bindings[remapLane];
        setRemapNote(
          `${keyLabel(e.code)} was on lane ${conflict + 1} — the two keys were swapped.`,
        );
      } else {
        setRemapNote('');
      }
      bindings[remapLane] = e.code;
      updateSettings({ keyBindings: bindings });
      setRemapLane(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [remapLane, updateSettings]);

  // Escape closes whichever panel is open.
  useEffect(() => {
    if (panel === 'none' || remapLane !== null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, remapLane]);

  return (
    <div className="screen start-screen">
      <h1 className="game-title">
        GUITAR<span>CLAUDE</span>
      </h1>
      <p className="tagline">procedural riffs · turn it up to eleven</p>

      <div className="song-list">
        {SONGS.map((song) => {
          const record = highScores[song.id];
          return (
            <button
              key={song.id}
              type="button"
              className={`song-card ${DIFFICULTY_CLASS[song.difficulty]}`}
              onClick={() => {
                audio.uiClick();
                startGame(song);
              }}
            >
              <span className="song-diff">
                {song.difficulty.toUpperCase()}
                <span className="song-style">{song.style}</span>
              </span>
              <span className="song-title">{song.title}</span>
              <span className="song-meta">
                {song.bpm} BPM · {Math.round(song.duration / 1000)}s · ~{song.targetNotes} notes
              </span>
              <span className="song-record">
                {record
                  ? `BEST ${record.score.toLocaleString()} · ${record.accuracy.toFixed(1)}%${
                      record.fullCombo ? ' · FC' : ''
                    }`
                  : 'no record yet'}
              </span>
            </button>
          );
        })}
      </div>

      {library.length > 0 && (
        <>
          <h3 className="library-heading">YOUR SONGS</h3>
          <div className="song-list">
            {library.map((meta) => {
              const record = highScores[meta.id];
              return (
                <div
                  key={meta.id}
                  className={`song-card imported ${DIFFICULTY_CLASS[meta.difficulty]}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    audio.uiClick();
                    void playImported(meta.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void playImported(meta.id);
                  }}
                >
                  <span className="song-diff">
                    {meta.difficulty.toUpperCase()}
                    <span className="song-style">Imported</span>
                  </span>
                  <span className="song-title">{meta.title}</span>
                  <span className="song-meta">
                    {meta.bpm} BPM · {Math.round(meta.duration / 1000)}s · {meta.noteCount} notes
                  </span>
                  <span className="song-record">
                    {record
                      ? `BEST ${record.score.toLocaleString()} · ${record.accuracy.toFixed(1)}%${
                          record.fullCombo ? ' · FC' : ''
                        }`
                      : 'no record yet'}
                  </span>
                  <button
                    type="button"
                    className="song-delete"
                    title="Delete from library"
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeImported(meta.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="menu-buttons">
        <button
          type="button"
          className="import-btn"
          disabled={importing}
          onClick={() => {
            audio.uiClick();
            fileRef.current?.click();
          }}
        >
          {importing ? 'Analyzing…' : 'Import Song'}
        </button>
        <button type="button" onClick={() => setPanel(panel === 'help' ? 'none' : 'help')}>
          How to Play
        </button>
        <button
          type="button"
          onClick={() => setPanel(panel === 'settings' ? 'none' : 'settings')}
        >
          Settings
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
        }}
      />
      {importError && <p className="hint warn">{importError}</p>}
      {importing && (
        <div className="overlay">
          <div className="panel import-panel">
            <h2>Analyzing…</h2>
            <p>Finding the beat, mapping riffs to frets. A few seconds.</p>
          </div>
        </div>
      )}

      {panel === 'help' && (
        <div className="overlay" onClick={() => setPanel('none')}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>How to Play</h2>
            <p>
              Gems scroll down the fretboard. <b>Hold the fret key and strum</b> as the gem
              crosses the fret bar — like a real guitar controller.
            </p>
            <ul>
              <li>
                <b>Frets:</b> {settings.keyBindings.map(keyLabel).join(' ')} (green → orange)
              </li>
              <li>
                <b>Strum:</b> ENTER, RIGHT SHIFT or ↑ / ↓
              </li>
              <li>
                <b>Star Power:</b> SPACE (needs half a gauge)
              </li>
            </ul>
            <p>
              Each gem = 50 pts × streak multiplier (×2 at 10, ×3 at 20, ×4 at 30). Star power
              doubles it — up to ×8.
            </p>
            <p>
              <b>Sustains:</b> keep the fret held to milk long notes. <b>HOPOs</b> (white-faced
              gems): while your streak is alive, tap the fret — no strum needed.{' '}
              <b>Star gems:</b> hit the whole phrase to charge star power. Strumming nothing is an{' '}
              <b>overstrum</b> — it breaks your streak.
            </p>
            <p>
              Misses and overstrums drain the <b>Rock Meter</b>. Bottom out and you get booed off
              stage.
            </p>
            <p>
              Strumming too hard? Turn <b>Strum Mode</b> off in Settings — fret keys then hit
              notes directly, no strumming (and no overstrums).
            </p>
            <p>
              <b>ESC</b> pause · <b>R</b> restart · <b>M</b> mute · <b>F3</b> FPS counter
            </p>
            <button type="button" onClick={() => setPanel('none')}>
              Close
            </button>
          </div>
        </div>
      )}

      {panel === 'settings' && (
        <div className="overlay" onClick={() => setPanel('none')}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h2>Settings</h2>

            {(
              [
                ['Master Volume', 'masterVolume'],
                ['SFX Volume', 'sfxVolume'],
                ['Music Volume', 'musicVolume'],
              ] as const
            ).map(([label, key]) => (
              <label key={key} className="setting-row">
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(settings[key] * 100)}
                  onChange={(e) => updateSettings({ [key]: Number(e.target.value) / 100 })}
                />
                <span className="setting-value">{Math.round(settings[key] * 100)}%</span>
              </label>
            ))}

            <label className="setting-row">
              <span>Note Speed</span>
              <select
                value={settings.noteSpeed}
                onChange={(e) => updateSettings({ noteSpeed: Number(e.target.value) })}
              >
                {NOTE_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>

            <label className="setting-row">
              <span>Strum Mode (GH2)</span>
              <input
                type="checkbox"
                checked={settings.strumMode}
                onChange={(e) => updateSettings({ strumMode: e.target.checked })}
              />
            </label>

            <label className="setting-row">
              <span>Screen Shake</span>
              <input
                type="checkbox"
                checked={settings.screenShake}
                onChange={(e) => updateSettings({ screenShake: e.target.checked })}
              />
            </label>

            <label className="setting-row">
              <span>Fullscreen</span>
              <input
                type="checkbox"
                checked={settings.fullscreen}
                onChange={(e) => updateSettings({ fullscreen: e.target.checked })}
              />
            </label>

            <div className="setting-row bindings-row">
              <span>Fret Keys</span>
              <div className="bindings">
                {settings.keyBindings.map((code, lane) => (
                  <button
                    // eslint-disable-next-line react/no-array-index-key
                    key={lane}
                    type="button"
                    className={`key-chip lane-${lane} ${remapLane === lane ? 'listening' : ''}`}
                    onClick={() => {
                      setRemapNote('');
                      setRemapLane(lane);
                    }}
                  >
                    {remapLane === lane ? '···' : keyLabel(code)}
                  </button>
                ))}
              </div>
            </div>
            {remapLane !== null && <p className="hint">Press the new key (ESC cancels).</p>}
            {remapNote && <p className="hint warn">{remapNote}</p>}

            <div className="panel-actions">
              <button
                type="button"
                onClick={() => updateSettings({ ...DEFAULT_SETTINGS })}
              >
                Reset Defaults
              </button>
              <button type="button" onClick={() => setPanel('none')}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
