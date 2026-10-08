import { Tabs } from "expo-router";
import { usePendingCount } from "../../src/badge";
import { useCan } from "../../src/session";
import { color } from "../../src/theme";
import { TabDot } from "../../src/ui";

const tabs = [
  ["index", "Today", "home"],
  ["orders", "Orders", "orders"],
  ["products", "Products", "products"],
  ["money", "Money", "money"],
  ["assistant", "Assistant", "assistant"],
] as const;

export default function TabsLayout() {
  const waiting = usePendingCount();
  const can = useCan();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border },
        sceneStyle: { backgroundColor: color.bg },
      }}
    >
      {tabs.map(([name, title, area]) => (
        <Tabs.Screen
          key={name}
          name={name}
          // Tabs a role can't use (Money and Assistant for staff) are hidden, not just locked.
          options={{ title, href: can(area) ? undefined : null, tabBarAccessibilityLabel: title, tabBarIcon: ({ focused }) => <TabDot focused={focused} count={name === "index" ? waiting : 0} /> }}
        />
      ))}
    </Tabs>
  );
}
