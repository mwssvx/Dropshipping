import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { flushQueue } from "../src/api";
import { onNotificationOpen } from "../src/push";
import { SessionProvider, useSession } from "../src/session";
import { Loading } from "../src/ui";
import { color } from "../src/theme";

function Gate() {
  const { ready, signedIn } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const atLogin = segments[0] === "login";
    if (!signedIn && !atLogin) router.replace("/login");
    else if (signedIn && atLogin) router.replace("/");
  }, [ready, signedIn, segments, router]);

  // Queued changes go out when the app comes back to the front.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && void flushQueue());
    const timer = setInterval(() => void flushQueue(), 30_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  useEffect(() => onNotificationOpen((url) => router.push(url as never)), [router]);

  if (!ready) return <Loading />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Gate />
    </SessionProvider>
  );
}
