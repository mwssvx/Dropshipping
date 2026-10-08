// Talks to the platform's app API (/api/app/v1). Screens read through useApi(), which shows the
// last copy it saved while offline. Changes that are safe to send later (approvals, price and stock
// edits) wait in a queue when there's no connection and go out once there is.
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { API_URL } from "./config";
import { kv, secret } from "./storage";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class OfflineError extends Error {
  constructor() {
    super("You're offline. Showing what was saved last.");
  }
}

/* Session */

type Session = { token: string | null; shopId: string | null };
let session: Session = { token: null, shopId: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export async function loadSession() {
  session = { token: await secret.get("token"), shopId: await kv.get("shopId") };
  queue = JSON.parse((await kv.get(`queue`)) ?? "[]");
  emit();
  return session;
}
export function getSession() {
  return session;
}
export async function setSession(next: Partial<Session>) {
  session = { ...session, ...next };
  if ("token" in next) next.token ? await secret.set("token", next.token) : await secret.remove("token");
  if ("shopId" in next) next.shopId ? await kv.set("shopId", next.shopId) : await kv.remove("shopId");
  emit();
}
export async function clearSession() {
  session = { token: null, shopId: null };
  queue = [];
  await secret.remove("token");
  await kv.clear();
  emit();
}

/* Requests */

let online = true;
export const isOnline = () => online;
function setOnline(v: boolean) {
  if (online !== v) {
    online = v;
    emit();
    if (v) void flushQueue();
  }
}

type Options = { method?: string; body?: unknown; raw?: { data: Blob | ArrayBuffer; type: string } };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (session.token) headers.authorization = `Bearer ${session.token}`;
  if (session.shopId) headers["x-shop-id"] = session.shopId;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers["content-type"] = opts.raw.type;
    body = opts.raw.data as BodyInit;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/app/v1/${path.replace(/^\//, "")}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    setOnline(false);
    throw new OfflineError();
  }
  setOnline(true);
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token) await clearSession();
  if (!res.ok) throw new ApiError(res.status, json.error ?? "Something went wrong. Please try again.");
  return json as T;
}

/* Reading, with an offline copy */

const cacheKey = (path: string) => `cache:${session.shopId ?? "-"}:${path}`;

export function useApi<T = any>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean; stale: boolean }>({ data: null, error: null, loading: true, stale: false });
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api<T>(path);
      void kv.set(cacheKey(path), JSON.stringify({ at: Date.now(), data }));
      if (mounted.current) setState({ data, error: null, loading: false, stale: false });
    } catch (e) {
      const cached = await kv.get(cacheKey(path));
      const data = cached ? (JSON.parse(cached).data as T) : null;
      if (mounted.current) setState({ data, error: (e as Error).message, loading: false, stale: !!data && e instanceof OfflineError });
    }
  }, [path]);

  // Fresh data each time the screen comes into view, and when the store changes.
  const shopId = useSyncExternalStore(subscribe, () => session.shopId);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, shopId]),
  );
  return { ...state, reload: load };
}

/* Changes that can wait for a connection */

export type Queued = { id: string; label: string; path: string; method: string; body: unknown; error?: string };
let queue: Queued[] = [];
let flushing = false;

async function saveQueue() {
  await kv.set("queue", JSON.stringify(queue));
  emit();
}

export function useQueue() {
  return useSyncExternalStore(subscribe, () => queue);
}
export function useOnline() {
  return useSyncExternalStore(subscribe, () => online);
}

/**
 * Sends a change now; if the phone is offline and `queueLabel` is given, keeps it to send later.
 * Returns "queued" in that case so the screen can say so.
 */
export async function send<T = any>(path: string, method: string, body: unknown, queueLabel?: string): Promise<T | "queued"> {
  try {
    return await api<T>(path, { method, body });
  } catch (e) {
    if (e instanceof OfflineError && queueLabel) {
      queue = [...queue, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label: queueLabel, path, method, body }];
      await saveQueue();
      return "queued";
    }
    throw e;
  }
}

export async function flushQueue() {
  if (flushing || !queue.length || !session.token) return;
  flushing = true;
  try {
    for (const item of queue.filter((q) => !q.error)) {
      try {
        await api(item.path, { method: item.method, body: item.body });
        queue = queue.filter((q) => q.id !== item.id);
      } catch (e) {
        if (e instanceof OfflineError) break;
        // The server said no (say, someone already decided it on the web): keep the reason, drop the change.
        queue = queue.map((q) => (q.id === item.id ? { ...q, error: (e as Error).message } : q));
      }
      await saveQueue();
    }
  } finally {
    flushing = false;
  }
}

export async function dismissQueued(id: string) {
  queue = queue.filter((q) => q.id !== id);
  await saveQueue();
}
