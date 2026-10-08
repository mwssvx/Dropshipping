import { ScrollView, StyleSheet, Text, View } from "react-native";
import { color, radius, space } from "./theme";

export function Screen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {children}
    </ScrollView>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function EmptyState({ heading, body, coming }: { heading: string; body: string; coming?: string }) {
  return (
    <Card>
      <Text style={s.heading}>{heading}</Text>
      <Text style={s.body}>{body}</Text>
      {coming ? <Text style={s.pill}>{coming}</Text> : null}
    </Card>
  );
}

export function TabDot({ focused }: { focused: boolean }) {
  return <View style={[s.dot, focused && s.dotActive]} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space(4), gap: space(4) },
  title: { fontSize: 28, fontWeight: "700", color: color.ink, letterSpacing: -0.4 },
  card: { backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(2) },
  heading: { fontSize: 17, fontWeight: "600", color: color.ink },
  body: { fontSize: 15, lineHeight: 21, color: color.muted },
  pill: { alignSelf: "flex-start", marginTop: space(1), paddingHorizontal: space(2), paddingVertical: 2, borderRadius: 999, backgroundColor: color.accentSoft, color: color.accent, fontSize: 12, fontWeight: "600", overflow: "hidden" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.border },
  dotActive: { backgroundColor: color.accent, width: 18 },
});
