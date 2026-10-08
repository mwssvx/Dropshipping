import { Tabs } from "expo-router";
import { usePendingCount } from "../../src/badge";
import { color } from "../../src/theme";
import { TabDot } from "../../src/ui";

const tabs = [
  ["index", "Today"],
  ["orders", "Orders"],
  ["products", "Products"],
  ["money", "Money"],
  ["assistant", "Assistant"],
] as const;

export default function TabsLayout() {
  const waiting = usePendingCount();
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
      {tabs.map(([name, title]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{ title, tabBarAccessibilityLabel: title, tabBarIcon: ({ focused }) => <TabDot focused={focused} count={name === "index" ? waiting : 0} /> }}
        />
      ))}
    </Tabs>
  );
}
