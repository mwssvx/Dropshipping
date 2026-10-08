import { useState } from "react";
import { Linking } from "react-native";
import { api } from "../src/api";
import { API_URL } from "../src/config";
import { useSession, type PushSettings } from "../src/session";
import { BackLink, Banner, Body, Button, Card, List, Pill, Row, Screen, Section, Toggle } from "../src/ui";
import Constants from "expo-constants";

export default function Settings() {
  const { me, switchShop, signOut, refreshMe } = useSession();
  const [push, setPush] = useState<PushSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = push ?? me?.push ?? null;

  async function save(next: PushSettings) {
    setPush(next);
    setError(null);
    try {
      const off = [...next.kinds.filter((k) => !k.on).map((k) => k.kind), ...(next.newOrderSound ? [] : ["new_order_sound"])];
      setPush(await api<PushSettings>("me/push", { method: "PUT", body: { off } }));
      await refreshMe();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Screen title="Settings" back={<BackLink href="/" label="Today" />}>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {me && me.shops.length > 1 ? (
        <Section title="Store">
          <List>
            {me.shops.map((s) => (
              <Row key={s.id} title={s.name} onPress={() => switchShop(s.id)} right={s.id === me.shop.id ? <Pill label="Open" tone="success" /> : undefined} a11y={`Switch to ${s.name}`} />
            ))}
          </List>
        </Section>
      ) : null}
      {settings ? (
        <Section title="Notifications">
          <Card>
            {settings.kinds.map((k) => (
              <Toggle key={k.kind} label={k.label} value={k.on} onChange={(on) => save({ ...settings, kinds: settings.kinds.map((x) => (x.kind === k.kind ? { ...x, on } : x)) })} />
            ))}
            <Toggle label="Sound for new orders" value={settings.newOrderSound} onChange={(on) => save({ ...settings, newOrderSound: on })} />
          </Card>
        </Section>
      ) : null}
      <Section title="Account">
        <List>
          {me ? <Row title={me.user.email} subtitle={me.shop.name} /> : null}
          <Row title="Open the web admin" right={<Pill label="↗" />} onPress={() => Linking.openURL(`${API_URL}/admin`)} />
          {me ? <Row title="View your store" right={<Pill label="↗" />} onPress={() => Linking.openURL(me.shop.address)} /> : null}
        </List>
        <Button label="Sign out" kind="secondary" onPress={signOut} />
        <Body muted>Version {Constants.expoConfig?.version ?? "1.0.0"}</Body>
      </Section>
    </Screen>
  );
}
