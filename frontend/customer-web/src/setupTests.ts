import '@testing-library/jest-dom/vitest';

// Node 22 introduced an experimental global localStorage that shadows jsdom
// and is undefined without --localstorage-file. Provide a memory mock if needed.
if (typeof window !== 'undefined' && (!window.localStorage || typeof window.localStorage.getItem !== 'function')) {
  let store: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };

  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
}
