const DB_NAME = 'gw2-combat-coach';
const STORE = 'kv';
const DB_VERSION = 1;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    request.onsuccess = () => {
      const entry = request.result as Entry<T> | undefined;
      if (!entry) return resolve(undefined);
      if (entry.expiresAt < Date.now()) return resolve(undefined);
      resolve(entry.value);
    };
    request.onerror = () => resolve(undefined);
  });
}

export async function cacheSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const entry: Entry<T> = { value, expiresAt: Date.now() + ttlMs };
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
  });
}

/** Reads through the cache, falling back to `load` and storing the result. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  void cacheSet(key, value, ttlMs);
  return value;
}
