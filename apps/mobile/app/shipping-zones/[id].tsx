import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { api, useApi } from "../../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen, Section, Toggle } from "../../src/ui";
import type { Zones } from "./index";

/** A new zone, or an existing zone's name and countries. A country can be in one zone only. */
export default function ZoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useApi<Zones>("shipping/zones");
  const isNew = id === "new";
  const [name, setName] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = data.data;
  const zone = d?.zones.find((z) => z.id === id);
  const n = name ?? zone?.name ?? "";
  const chosen = picked ?? zone?.countries ?? [];
  const takenBy = (code: string) => d?.zones.find((z) => z.id !== id && z.countries.includes(code))?.name ?? null;

  async function run(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method, body });
      router.replace("/shipping-zones");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title={isNew ? "New zone" : (zone?.name ?? "Zone")} back={<BackLink href="/shipping-zones" label="Shipping rates" />}>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : !isNew && !zone ? (
        <Body>This zone was deleted.</Body>
      ) : (
        <>
          <Card>
            <Field label="Zone name" value={n} onChangeText={setName} placeholder="Europe" />
          </Card>
          <Section title="Countries">
            {d.countries.map((c) => {
              const other = takenBy(c.code);
              return (
                <Toggle
                  key={c.code}
                  label={other ? `${c.name} (in ${other})` : c.name}
                  value={chosen.includes(c.code)}
                  disabled={!!other}
                  onChange={(on) => setPicked(on ? [...chosen, c.code] : chosen.filter((x) => x !== c.code))}
                />
              );
            })}
          </Section>
          <Button
            label={isNew ? "Add zone" : "Save zone"}
            busy={busy}
            disabled={busy || !n.trim()}
            onPress={() => void run(isNew ? "shipping/zones" : `shipping/zones/${id}`, isNew ? "POST" : "PUT", { name: n, countries: chosen })}
          />
          {!isNew ? (
            confirm ? (
              <Card>
                <Body>{`Delete the ${zone!.name} zone and its rates? Buyers in its countries can't check out until another zone has them.`}</Body>
                <Button label={`Delete ${zone!.name} now`} kind="danger" busy={busy} disabled={busy} onPress={() => void run(`shipping/zones/${id}`, "DELETE")} />
                <Button label="Keep it" kind="ghost" onPress={() => setConfirm(false)} />
              </Card>
            ) : (
              <Button label="Delete zone…" kind="ghost" disabled={busy} onPress={() => setConfirm(true)} />
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}
