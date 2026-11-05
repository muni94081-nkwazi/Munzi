import axios from 'axios';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const baseURL = (Constants.expoConfig?.extra?.apiBaseUrl as string) || 'http://localhost:5000/api';

export const client = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('bulk_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error?.response?.data?.message || error?.message || 'Something went wrong. Please try again.';
    return Promise.reject({ ...error, message });
  }
);

// ─── Offline cache helpers ───────────────────────────────────────────
// Every list/detail GET used on a "browse" screen goes through these so the
// app can show the last-known data when the device has no connection.
const CACHE_PREFIX = 'bulk_cache_';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h - stale data is still better than a blank screen offline

export async function cacheSet(key: string, value: unknown) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ value, cachedAt: Date.now() }));
  } catch {
    // Non-fatal - caching is a best-effort convenience.
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value: T; cachedAt: number };
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) return null;
    return parsed.value;
  } catch {
    return null;
  }
}

/**
 * fetchWithCache
 * Tries the network first; on success, caches the result. On failure
 * (typically offline), falls back to whatever was last cached under `key`.
 * Throws only if there's no network AND no cache to fall back to.
 */
export async function fetchWithCache<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await fetcher();
    await cacheSet(key, data);
    return { data, fromCache: false };
  } catch (err) {
    const cached = await cacheGet<T>(key);
    if (cached !== null) return { data: cached, fromCache: true };
    throw err;
  }
}
