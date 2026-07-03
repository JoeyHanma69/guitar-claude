import type { Difficulty, GeneratedSong } from './types';

// ---------------------------------------------------------------------------
// Imported-song library, persisted in IndexedDB (works in both the Electron
// app and the browser build). Each record stores the finished chart plus the
// ORIGINAL encoded audio bytes — far smaller than decoded PCM — and the audio
// is decoded again on play.
// ---------------------------------------------------------------------------

const DB_NAME = 'guitar-claude';
const STORE = 'songs';

export interface ImportedSongMeta {
  id: string;
  title: string;
  difficulty: Difficulty;
  bpm: number;
  duration: number;
  noteCount: number;
  savedAt: string;
}

type StoredSongRecord = Omit<GeneratedSong, 'buffer'> & {
  audio: ArrayBuffer;
  savedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function saveImportedSong(song: GeneratedSong, audio: ArrayBuffer): Promise<void> {
  const db = await openDb();
  try {
    const { buffer: _unused, ...chart } = song;
    const record: StoredSongRecord = {
      ...chart,
      notes: chart.notes.map((n) => ({ ...n, judged: false, rating: null })),
      audio,
      savedAt: new Date().toISOString(),
    };
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function listImportedSongs(): Promise<ImportedSongMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll();
    await txDone(tx);
    const records = (request.result ?? []) as StoredSongRecord[];
    return records
      .map((r) => ({
        id: r.id,
        title: r.title,
        difficulty: r.difficulty,
        bpm: r.bpm,
        duration: r.duration,
        noteCount: r.notes.length,
        savedAt: r.savedAt,
      }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } finally {
    db.close();
  }
}

export async function deleteImportedSong(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

/** Load a stored song and decode its audio, ready to hand to startGame. */
export async function loadImportedSong(id: string): Promise<GeneratedSong> {
  const db = await openDb();
  let record: StoredSongRecord | undefined;
  try {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(id);
    await txDone(tx);
    record = request.result as StoredSongRecord | undefined;
  } finally {
    db.close();
  }
  if (!record) throw new Error('Song not found in your library.');

  const ctx = new AudioContext();
  try {
    // decodeAudioData detaches the buffer it is given — pass a copy so the
    // stored record stays intact.
    const buffer = await ctx.decodeAudioData(record.audio.slice(0));
    const { audio: _audio, savedAt: _savedAt, ...chart } = record;
    return { ...chart, notes: chart.notes.map((n) => ({ ...n })), buffer };
  } finally {
    void ctx.close();
  }
}
