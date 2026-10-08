import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { api, clearSession, flushQueue, getSession, loadSession, setSession, subscribe } from "./api";
import { registerForPush, unregisterPush } from "./push";

export type ShopLink = { id: string; name: string; handle: string; role: string };
export type PushSettings = { kinds: { kind: string; label: string; on: boolean }[]; newOrderSound: boolean };
export type Me = {
  user: { id: string; email: string };
  shop: { id: string; name: string; handle: string; currency: string; plan: string; status: string; address: string };
  shops: ShopLink[];
  push: PushSettings;
  testMode: boolean;
  role: "owner" | "admin" | "staff";
  /** The parts of the store this person's role can open (Today, orders, money, and so on). */
  can: string[];
};

type SessionValue = {
  ready: boolean;
  signedIn: boolean;
  me: Me | null;
  refreshMe: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchShop: (id: string) => Promise<void>;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const token = useSyncExternalStore(subscribe, () => getSession().token);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api<Me>("me");
      setMe(m);
      if (getSession().shopId !== m.shop.id) await setSession({ shopId: m.shop.id });
    } catch {
      // Offline: keep what we had. A 401 clears the session, which sends the person to sign in.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await loadSession();
      setReady(true);
      if (s.token) {
        await refreshMe();
        void flushQueue();
        void registerForPush();
      }
    })();
  }, [refreshMe]);

  const value: SessionValue = {
    ready,
    signedIn: !!token,
    me: token ? me : null,
    refreshMe,
    signIn: async (email, password) => {
      const r = await api<{ token: string; shops: ShopLink[] }>("auth/login", { body: { email, password } });
      await setSession({ token: r.token, shopId: r.shops[0]?.id ?? null });
      await refreshMe();
      void registerForPush();
    },
    signOut: async () => {
      await unregisterPush().catch(() => {});
      await api("auth/logout", { method: "POST", body: {} }).catch(() => {});
      await clearSession();
      setMe(null);
    },
    switchShop: async (id) => {
      await setSession({ shopId: id });
      await refreshMe();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}

/** Whether the signed-in person's role includes an area, such as "money" or "refunds". */
export function useCan() {
  const { me } = useSession();
  return (area: string) => !me?.can || me.can.includes(area);
}
