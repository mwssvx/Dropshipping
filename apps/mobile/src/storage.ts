// Phone storage: the session token in the keychain or keystore, cached screens and queued
// changes in a small SQLite key-value store. storage.web.ts is the browser version.
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

export const secret = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};

export const kv = {
  get: (key: string) => Storage.getItemAsync(key),
  set: (key: string, value: string) => Storage.setItemAsync(key, value),
  remove: async (key: string) => {
    await Storage.removeItemAsync(key);
  },
  clear: () => Storage.clearAsync(),
};
