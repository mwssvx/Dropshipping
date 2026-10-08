// Browser version of storage.ts, for the web build used in tests and previews.
const safe = <T,>(fn: () => T, fallback: T) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const secret = {
  get: async (key: string) => safe(() => localStorage.getItem(`secret:${key}`), null),
  set: async (key: string, value: string) => safe(() => localStorage.setItem(`secret:${key}`, value), undefined),
  remove: async (key: string) => safe(() => localStorage.removeItem(`secret:${key}`), undefined),
};

export const kv = {
  get: async (key: string) => safe(() => localStorage.getItem(`kv:${key}`), null),
  set: async (key: string, value: string) => safe(() => localStorage.setItem(`kv:${key}`, value), undefined),
  remove: async (key: string) => safe(() => localStorage.removeItem(`kv:${key}`), undefined),
  clear: async () =>
    safe(() => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("kv:")) localStorage.removeItem(k);
    }, undefined),
};
