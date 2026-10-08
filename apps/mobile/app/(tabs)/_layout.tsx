import { Tabs } from "expo-router";
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
        <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: ({ focused }) => <TabDot focused={focused} /> }} />
      ))}
    </Tabs>
  );
}
