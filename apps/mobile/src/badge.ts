import { useSyncExternalStore } from "react";

// How many agent proposals wait for the merchant, shown on the Today tab.
let count = 0;
const listeners = new Set<() => void>();
export function setPendingCount(n: number) {
  if (n !== count) {
    count = n;
    listeners.forEach((l) => l());
  }
}
export function usePendingCount() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count,
  );
}
