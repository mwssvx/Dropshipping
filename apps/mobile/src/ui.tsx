import { Link, type Href } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View, type KeyboardTypeOptions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { dismissQueued, useOnline, useQueue } from "./api";
import { color, radius, space, tones, type Tone } from "./theme";

export function Screen({
  title,
  right,
  children,
  onRefresh,
  refreshing = false,
  back,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  back?: React.ReactNode;
}) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }} edges={["top"]}>
      <OfflineBar />
      <ScrollView
        style={s.screen}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} /> : undefined}
      >
        {back}
        <View style={s.titleRow}>
          <Text style={s.title} role="heading" aria-level={1}>
            {title}
          </Text>
          {right}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function BackLink({ href, label }: { href: Href; label: string }) {
  return (
    <Link href={href} style={s.back}>
      ← {label}
    </Link>
  );
}

/** Says when the phone is offline, and lists changes waiting to be sent. */
export function OfflineBar() {
  const online = useOnline();
  const queue = useQueue();
  const waiting = queue.filter((q) => !q.error);
  const failed = queue.filter((q) => q.error);
  if (online && !queue.length) return null;
  return (
    <View style={s.offline} role="status">
      {!online && <Text style={s.offlineText}>You're offline. Showing what was saved last.</Text>}
      {waiting.length > 0 && (
        <Text style={s.offlineText}>
          Waiting to send ({waiting.length}): {waiting.map((q) => q.label).join(", ")}
        </Text>
      )}
      {failed.map((q) => (
        <View key={q.id} style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
          <Text style={[s.offlineText, { flex: 1 }]}>
            Couldn't send "{q.label}": {q.error}
          </Text>
          <Button label="OK" kind="ghost" onPress={() => dismissQueued(q.id)} />
        </View>
      ))}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ gap: space(2) }} role="region" aria-label={title}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle} role="heading" aria-level={2}>
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <Card>
      <Text style={s.heading}>{heading}</Text>
      <Text style={s.body}>{body}</Text>
    </Card>
  );
}

export function Body({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[s.body, !muted && { color: color.ink }, style]}>{children}</Text>;
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={s.heading}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = "primary",
  busy,
  disabled,
  a11y,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  a11y?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [s.btn, s[`btn_${kind}`], off && { opacity: 0.6 }, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator size="small" color={kind === "primary" || kind === "danger" ? "#fff" : color.accent} /> : null}
      <Text style={[s.btnText, s[`btnText_${kind}`]]}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  secure,
  autoCapitalize = "sentences",
  hint,
  onSubmit,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences" | "words";
  hint?: string;
  onSubmit?: () => void;
}) {
  return (
    <View style={{ gap: space(1) }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[s.input, multiline && { minHeight: 96, textAlignVertical: "top" }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.muted}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize}
        autoCorrect={!secure && autoCapitalize !== "none"}
        onSubmitEditing={onSubmit}
      />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={s.toggle}>
      <Text style={[s.body, { color: color.ink, flex: 1 }]}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: color.accent, false: color.border }} />
    </View>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return <Text style={[s.pill, { color: tones[tone].fg, backgroundColor: tones[tone].bg }]}>{label}</Text>;
}

export function Banner({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <View style={[s.banner, { backgroundColor: tones[tone].bg }]} role={tone === "critical" ? "alert" : "status"}>
      <Text style={{ color: tones[tone].fg, fontSize: 15, lineHeight: 21 }}>{children}</Text>
    </View>
  );
}

export function Row({ title, subtitle, right, href, onPress, a11y }: { title: string; subtitle?: string; right?: React.ReactNode; href?: Href; onPress?: () => void; a11y?: string }) {
  const inner = (
    <View style={s.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={s.hint} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (href)
    return (
      <Link href={href} asChild>
        <Pressable accessibilityRole="link" accessibilityLabel={a11y ?? title}>
          {inner}
        </Pressable>
      </Link>
    );
  if (onPress)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? title} onPress={onPress}>
        {inner}
      </Pressable>
    );
  return inner;
}

export function List({ children }: { children: React.ReactNode }) {
  return <View style={s.list}>{children}</View>;
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.hint}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View style={s.segmented} role="tablist" aria-label={label}>
      {options.map(([v, text]) => (
        <Pressable key={v} role="tab" aria-selected={v === value} onPress={() => onChange(v)} style={[s.segment, v === value && s.segmentOn]}>
          <Text style={[s.segmentText, v === value && { color: color.ink, fontWeight: "600" }]}>{text}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: space(8), alignItems: "center" }} accessibilityLabel="Loading">
      <ActivityIndicator color={color.accent} />
    </View>
  );
}

/** What went wrong loading a screen, unless an offline copy is showing (the bar says so then). */
export function LoadError({ error, stale, retry }: { error: string | null; stale: boolean; retry: () => void }) {
  if (!error || stale) return null;
  return (
    <Card>
      <Text style={[s.body, { color: color.critical }]}>{error}</Text>
      <Button label="Try again" kind="secondary" onPress={retry} />
    </Card>
  );
}

export function TabDot({ focused, count }: { focused: boolean; count?: number }) {
  return (
    <View>
      <View style={[s.dot, focused && s.dotActive]} />
      {count ? <Text style={s.badge}>{count}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space(4), paddingBottom: space(12), gap: space(4), maxWidth: 720, width: "100%", alignSelf: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3) },
  title: { fontSize: 28, fontWeight: "700", color: color.ink, letterSpacing: -0.4, flexShrink: 1 },
  back: { color: color.accent, fontSize: 15, fontWeight: "500" },
  card: { backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: radius.lg, padding: space(4), gap: space(3) },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 17, fontWeight: "600", color: color.ink },
  heading: { fontSize: 17, fontWeight: "600", color: color.ink },
  body: { fontSize: 15, lineHeight: 21, color: color.muted },
  hint: { fontSize: 13, lineHeight: 18, color: color.muted },
  label: { fontSize: 14, fontWeight: "600", color: color.ink },
  input: { backgroundColor: color.surface, borderColor: color.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(3), fontSize: 16, color: color.ink },
  btn: { flexDirection: "row", gap: space(2), alignItems: "center", justifyContent: "center", minHeight: 44, paddingHorizontal: space(4), borderRadius: radius.md, borderWidth: 1 },
  btn_primary: { backgroundColor: color.accent, borderColor: color.accent },
  btn_secondary: { backgroundColor: color.surface, borderColor: color.border },
  btn_danger: { backgroundColor: color.critical, borderColor: color.critical },
  btn_ghost: { backgroundColor: "transparent", borderColor: "transparent", paddingHorizontal: space(2) },
  btnText: { fontSize: 15, fontWeight: "600" },
  btnText_primary: { color: "#fff" },
  btnText_secondary: { color: color.ink },
  btnText_danger: { color: "#fff" },
  btnText_ghost: { color: color.accent },
  pill: { alignSelf: "flex-start", paddingHorizontal: space(2), paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: "600", overflow: "hidden" },
  banner: { borderRadius: radius.md, padding: space(3) },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(3), paddingHorizontal: space(4), backgroundColor: color.surface },
  rowTitle: { fontSize: 15, fontWeight: "500", color: color.ink },
  list: { borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: "hidden", backgroundColor: color.border, gap: 1 },
  stat: { flex: 1, backgroundColor: color.surface, padding: space(3), gap: 2 },
  statValue: { fontSize: 22, fontWeight: "600", color: color.ink, fontVariant: ["tabular-nums"] },
  segmented: { flexDirection: "row", backgroundColor: color.sunken, borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, paddingVertical: space(2), alignItems: "center", borderRadius: radius.sm + 2 },
  segmentOn: { backgroundColor: color.surface },
  segmentText: { fontSize: 14, color: color.muted },
  toggle: { flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) },
  offline: { backgroundColor: color.warningSoft, paddingHorizontal: space(4), paddingVertical: space(2), gap: space(1) },
  offlineText: { color: color.warning, fontSize: 13 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.border },
  dotActive: { backgroundColor: color.accent, width: 18 },
  badge: { position: "absolute", top: -10, left: 12, backgroundColor: color.warning, color: "#fff", fontSize: 10, fontWeight: "700", paddingHorizontal: 5, borderRadius: 8, overflow: "hidden" },
});
