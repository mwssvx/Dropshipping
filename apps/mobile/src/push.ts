// Push notifications on iOS and Android. Each notification carries the screen to open.
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";
import { kv } from "./storage";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function registerForPush() {
  if (Platform.OS === "web" || !Device.isDevice) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Store updates", importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api("devices", { body: { token, platform: Platform.OS } });
  await kv.set("pushToken", token);
}

export async function unregisterPush() {
  const token = await kv.get("pushToken");
  if (token) await api("devices", { method: "DELETE", body: { token } });
}

/** Opens the screen a notification points at, including one tapped while the app was closed. */
export function onNotificationOpen(open: (url: string) => void) {
  if (Platform.OS === "web") return () => {};
  const go = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === "string" && url.startsWith("/")) open(url);
  };
  void Notifications.getLastNotificationResponseAsync().then(go);
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}
