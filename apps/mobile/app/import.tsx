import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { api } from "../src/api";
import { money, parseMoney } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, Field, Heading, Screen } from "../src/ui";
import { color, radius, space } from "../src/theme";

type Preview = {
  supplier: { name: string; label: string };
  alreadyImported: { id: string; title: string } | null;
  product: { title: string; imageUrl: string | null; variants: { ref: string; title: string; costMinor: number; stock: number | null; suggestedPriceMinor: number }[] };
};

/** Import by link. Also opened by storefront://import?url=… links and the share sheet. */
export default function ImportScreen() {
  const params = useLocalSearchParams<{ url?: string }>();
  const router = useRouter();
  const cur = useSession().me?.shop.currency ?? "USD";
  const [url, setUrl] = useState(params.url ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [title, setTitle] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookUp(link = url) {
    if (!link.trim()) return;
    setBusy("look");
    setError(null);
    setPreview(null);
    try {
      const p = await api<Preview>("imports/preview", { body: { url: link.trim() } });
      setPreview(p);
      setTitle(p.product.title);
      setPrices(Object.fromEntries(p.product.variants.map((v) => [v.ref, (v.suggestedPriceMinor / 100).toFixed(2)])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (params.url) void lookUp(params.url);
    // Only when opened with a link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url]);

  async function paste() {
    const text = (await Clipboard.getStringAsync()).trim();
    const link = text.match(/https?:\/\/\S+/)?.[0];
    if (!link) return setError("There's no link on your clipboard. Copy the product's link from your supplier first.");
    setUrl(link);
    void lookUp(link);
  }

  async function save(publish: boolean) {
    if (!preview) return;
    setBusy(publish ? "publish" : "draft");
    setError(null);
    try {
      const priceMap: Record<string, number> = {};
      for (const v of preview.product.variants) {
        const n = parseMoney(prices[v.ref] ?? "");
        if (n === null) throw new Error(`Enter a price for ${v.title}.`);
        priceMap[v.ref] = n;
      }
      const r = await api<{ id: string }>("imports", { body: { url: url.trim(), title, prices: priceMap, publish } });
      router.replace(`/products/${r.id}${publish ? "" : "?imported=1"}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <Screen title="Import a product" back={<BackLink href="/products" label="Products" />}>
      <Card>
        <Field label="Supplier link" value={url} onChangeText={setUrl} placeholder="https://…" autoCapitalize="none" keyboardType="url" onSubmit={() => lookUp()} />
        <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
          <Button label="Look it up" onPress={() => lookUp()} busy={busy === "look"} disabled={!url.trim()} />
          <Button label="Paste link" kind="secondary" onPress={paste} />
        </View>
        <Body muted>Tip: in your supplier's app or browser, tap Share and pick this app to land here with the link filled in.</Body>
      </Card>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      {preview ? (
        <Card>
          <Body muted>From {preview.supplier.label}</Body>
          {preview.alreadyImported ? <Banner tone="warning">You've already imported this as "{preview.alreadyImported.title}".</Banner> : null}
          {preview.product.imageUrl ? (
            <Image source={{ uri: preview.product.imageUrl }} accessibilityLabel="Supplier photo" style={{ width: "100%", aspectRatio: 1, borderRadius: radius.md, backgroundColor: color.sunken }} />
          ) : null}
          <Field label="Title" value={title} onChangeText={setTitle} />
          {preview.product.variants.map((v) => {
            const price = parseMoney(prices[v.ref] ?? "");
            return (
              <View key={v.ref} style={{ gap: space(1) }}>
                <Field
                  label={preview.product.variants.length > 1 ? `Price for ${v.title}` : "Your price"}
                  value={prices[v.ref] ?? ""}
                  onChangeText={(t) => setPrices((p) => ({ ...p, [v.ref]: t }))}
                  keyboardType="decimal-pad"
                />
                <Body muted>
                  Costs {money(v.costMinor, cur)}
                  {price !== null ? `, you keep ${money(price - v.costMinor, cur)} before fees` : ""}
                  {v.stock !== null ? ` · ${v.stock} in stock` : ""}
                </Body>
              </View>
            );
          })}
          <Heading>Then</Heading>
          <Button label="Import as draft" onPress={() => save(false)} busy={busy === "draft"} disabled={!!busy || !!preview.alreadyImported} />
          <Button label="Import and put on sale" kind="secondary" onPress={() => save(true)} busy={busy === "publish"} disabled={!!busy || !!preview.alreadyImported} />
          <Body muted>A draft lets the AI write the listing straight away, before buyers see it.</Body>
        </Card>
      ) : null}
    </Screen>
  );
}
