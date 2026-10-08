import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { api, send, useApi } from "../../src/api";
import { money, parseMoney } from "../../src/format";
import { useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, Field, Heading, LoadError, Loading, Pill, Screen, Section } from "../../src/ui";
import { color, radius, space } from "../../src/theme";
import { STATUS, type Product } from "../../src/product";

const plain = (html: string) => html.replace(/<\/(p|li|h\d)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

export default function ProductScreen() {
  const { id, imported } = useLocalSearchParams<{ id: string; imported?: string }>();
  const product = useApi<Product>(`products/${id}`);
  const cur = useSession().me?.shop.currency ?? "USD";
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical" | "info"; text: string } | null>(
    imported ? { tone: "success", text: "Imported as a draft. Next: let AI write the listing, then put it on sale." } : null,
  );
  const p = product.data;

  useEffect(() => {
    if (!p) return;
    setPrices(Object.fromEntries(p.variants.map((v) => [v.id, (v.priceMinor / 100).toFixed(2)])));
    setStock(Object.fromEntries(p.variants.map((v) => [v.id, v.stock === null ? "" : String(v.stock)])));
  }, [p]);

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setNote(null);
    try {
      setNote({ tone: "success", text: await fn() });
      await product.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function photo(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setNote({ tone: "critical", text: fromCamera ? "Allow camera access in Settings to take photos." : "Allow photo access in Settings to choose photos." });
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: true, aspect: [1, 1] };
    const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    await act("photo", async () => {
      const blob = await (await fetch(asset.uri)).blob();
      await api(`products/${id}/photo`, { raw: { data: blob, type: asset.mimeType ?? blob.type ?? "image/jpeg" } });
      return "Photo saved.";
    });
  }

  const back = <BackLink href="/products" label="Products" />;
  if (!p) return <Screen title="Product" back={back}>{product.loading ? <Loading /> : <LoadError error={product.error} stale={false} retry={product.reload} />}</Screen>;

  const changes = p.variants
    .map((v) => {
      const price = parseMoney(prices[v.id] ?? "");
      const st = (stock[v.id] ?? "").trim();
      const stockN = st === "" ? null : Number.parseInt(st, 10);
      return { id: v.id, priceMinor: price ?? v.priceMinor, stock: Number.isNaN(stockN) ? v.stock : stockN, v };
    })
    .filter((c) => c.priceMinor !== c.v.priceMinor || c.stock !== c.v.stock);

  return (
    <Screen title={p.title} back={back} onRefresh={product.reload} refreshing={product.loading}>
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <Pill label={STATUS[p.status].label} tone={STATUS[p.status].tone} />
        {p.aiGenerated ? <Pill label="Written with AI" tone="info" /> : null}
      </View>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}

      <Card>
        {p.imageUrl ? (
          <Image source={{ uri: p.imageUrl }} accessibilityLabel="Product photo" style={{ width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: color.sunken }} />
        ) : (
          <Body muted>No photo yet.</Body>
        )}
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
          <Button label="Take a photo" kind="secondary" onPress={() => photo(true)} busy={busy === "photo"} />
          <Button label="Choose a photo" kind="secondary" onPress={() => photo(false)} disabled={busy === "photo"} />
        </View>
      </Card>

      <Section title="Listing">
        <Card>
          <Body>{plain(p.descriptionHtml) || "No description yet."}</Body>
          <Button
            label="Write with AI"
            kind="secondary"
            busy={busy === "listing"}
            onPress={() => act("listing", async () => (await api<{ message: string }>(`products/${id}/listing`, { body: {} })).message)}
          />
          {p.status === "active" ? <Body muted>It's on sale, so new wording waits for your OK on Today.</Body> : null}
        </Card>
      </Section>

      <Section title="Price and stock">
        {p.variants.map((v) => (
          <Card key={v.id}>
            {p.variants.length > 1 ? <Heading>{v.title}</Heading> : null}
            <Field label={p.variants.length > 1 ? `Price for ${v.title}` : "Price"} value={prices[v.id] ?? ""} onChangeText={(t) => setPrices((x) => ({ ...x, [v.id]: t }))} keyboardType="decimal-pad" />
            {v.costMinor !== null ? (
              <Body muted>
                Costs you {money(v.costMinor, cur)} from the supplier
                {parseMoney(prices[v.id] ?? "") ? `, so you keep ${money((parseMoney(prices[v.id] ?? "") ?? 0) - v.costMinor, cur)} before fees.` : "."}
              </Body>
            ) : null}
            <Field label={p.variants.length > 1 ? `Stock for ${v.title}` : "Stock"} value={stock[v.id] ?? ""} onChangeText={(t) => setStock((x) => ({ ...x, [v.id]: t }))} keyboardType="number-pad" hint="Leave empty to follow the supplier's stock." />
          </Card>
        ))}
        {changes.length > 0 ? (
          <Button
            label="Save price and stock"
            busy={busy === "save"}
            onPress={() =>
              act("save", async () => {
                const r = await send(`products/${id}`, "PATCH", { variants: changes.map(({ id, priceMinor, stock }) => ({ id, priceMinor, stock })) }, `Price and stock for ${p.title}`);
                return r === "queued" ? "Saved. It's sent when you're back online." : "Saved.";
              })
            }
          />
        ) : null}
      </Section>

      <Section title="On your store">
        {p.status === "active" ? (
          <Button label="Take off sale" kind="secondary" busy={busy === "status"} onPress={() => act("status", async () => (await api(`products/${id}`, { method: "PATCH", body: { status: "draft" } }), "Taken off sale. It's a draft now."))} />
        ) : (
          <Button label="Put on sale" busy={busy === "status"} onPress={() => act("status", async () => (await api(`products/${id}`, { method: "PATCH", body: { status: "active" } }), "It's on sale now."))} />
        )}
      </Section>
    </Screen>
  );
}
