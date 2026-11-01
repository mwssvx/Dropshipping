import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { api, send, useApi } from "../../src/api";
import { kg, money, parseKg, parseMoney } from "../../src/format";
import { useCan, useSession } from "../../src/session";
import { BackLink, Banner, Body, Button, Card, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section, Segmented, Toggle } from "../../src/ui";
import { color, radius, space } from "../../src/theme";
import { STATUS, type Product } from "../../src/product";

const plain = (html: string) => html.replace(/<\/(p|li|h\d)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();

export default function ProductScreen() {
  const { id, imported } = useLocalSearchParams<{ id: string; imported?: string }>();
  const product = useApi<Product>(`products/${id}`);
  const cur = useSession().me?.shop.currency ?? "USD";
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [was, setWas] = useState<Record<string, string>>({});
  const [stock, setStock] = useState<Record<string, string>>({});
  const [weight, setWeight] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [hs, setHs] = useState("");
  const [origin, setOrigin] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical" | "info"; text: string } | null>(
    imported ? { tone: "success", text: "Imported as a draft. Next: let AI write the listing, then put it on sale." } : null,
  );
  const p = product.data;

  useEffect(() => {
    if (!p) return;
    setPrices(Object.fromEntries(p.variants.map((v) => [v.id, (v.priceMinor / 100).toFixed(2)])));
    setWas(Object.fromEntries(p.variants.map((v) => [v.id, v.compareAtMinor === null ? "" : (v.compareAtMinor / 100).toFixed(2)])));
    setStock(Object.fromEntries(p.variants.map((v) => [v.id, v.stock === null ? "" : String(v.stock)])));
    setWeight(Object.fromEntries(p.variants.map((v) => [v.id, kg(v.weightGrams)])));
    setHs(p.hsCode ?? "");
    setOrigin(p.originCountry ?? "");
    setFrom(p.shipsFrom ?? "");
    setCost(Object.fromEntries(p.variants.map((v) => [v.id, v.costMinor === null ? "" : (v.costMinor / 100).toFixed(2)])));
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
      const grams = parseKg(weight[v.id] ?? "");
      const c = (cost[v.id] ?? "").trim();
      const costMinor = c === "" ? null : (parseMoney(c) ?? v.costMinor);
      const w = (was[v.id] ?? "").trim();
      const compareAtMinor = w === "" ? null : (parseMoney(w) ?? v.compareAtMinor);
      return {
        id: v.id,
        priceMinor: price ?? v.priceMinor,
        stock: Number.isNaN(stockN) ? v.stock : stockN,
        // Not a number, or 0: keep what it was.
        weightGrams: grams === null || grams > 0 ? grams : v.weightGrams,
        costMinor,
        compareAtMinor,
        v,
      };
    })
    .filter(
      (c) =>
        c.priceMinor !== c.v.priceMinor ||
        c.compareAtMinor !== c.v.compareAtMinor ||
        c.stock !== c.v.stock ||
        (p.ships && c.weightGrams !== c.v.weightGrams) ||
        (p.ownStock && c.costMinor !== c.v.costMinor),
    );
  const many = p.variants.length > 1;
  // What the merchant keeps of the price they typed, once they've said what it costs them.
  const keep = (vid: string) => {
    const price = parseMoney(prices[vid] ?? "");
    const c = parseMoney((cost[vid] ?? "").trim());
    return price !== null && c !== null ? `You keep ${money(price - c, cur)} of each before fees.` : null;
  };

  // How much off the crossed-out price shows, once it's above the price.
  const off = (vid: string) => {
    const price = parseMoney(prices[vid] ?? "");
    const w = parseMoney((was[vid] ?? "").trim());
    if (price === null || w === null) return null;
    return w > price ? `Buyers see ${Math.round(((w - price) / w) * 100)}% off.` : "Make it higher than the price, or leave it empty.";
  };

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
            {many ? <Heading>{v.title}</Heading> : null}
            <Field label={many ? `Price for ${v.title}` : "Price"} value={prices[v.id] ?? ""} onChangeText={(t) => setPrices((x) => ({ ...x, [v.id]: t }))} keyboardType="decimal-pad" />
            <Field
              label={many ? `Crossed-out price for ${v.title}` : "Crossed-out price"}
              value={was[v.id] ?? ""}
              onChangeText={(t) => setWas((x) => ({ ...x, [v.id]: t }))}
              keyboardType="decimal-pad"
              placeholder="No sale"
              hint={off(v.id) ?? "Shown struck through next to the price, like a sale. Leave empty for none."}
            />
            {p.ownStock ? (
              <Field
                label={many ? `What ${v.title} costs you` : "What it costs you"}
                value={cost[v.id] ?? ""}
                onChangeText={(t) => setCost((x) => ({ ...x, [v.id]: t }))}
                keyboardType="decimal-pad"
                hint={keep(v.id) ?? "What you paid for each, so Money can show your profit."}
              />
            ) : v.costMinor !== null ? (
              <Body muted>
                Costs you {money(v.costMinor, cur)} from the supplier
                {parseMoney(prices[v.id] ?? "") ? `, so you keep ${money((parseMoney(prices[v.id] ?? "") ?? 0) - v.costMinor, cur)} before fees.` : "."}
              </Body>
            ) : null}
            <Field label={p.variants.length > 1 ? `Stock for ${v.title}` : "Stock"} value={stock[v.id] ?? ""} onChangeText={(t) => setStock((x) => ({ ...x, [v.id]: t }))} keyboardType="number-pad" hint="Leave empty to follow the supplier's stock." />
            {p.ships ? (
              <Field
                label={many ? `Weight of ${v.title} packed (kg)` : "Weight packed (kg)"}
                value={weight[v.id] ?? ""}
                onChangeText={(t) => setWeight((x) => ({ ...x, [v.id]: t }))}
                keyboardType="decimal-pad"
                hint="With its box, for shipping rates by weight."
              />
            ) : null}
          </Card>
        ))}
        {changes.length > 0 ? (
          <Button
            label="Save changes"
            busy={busy === "save"}
            onPress={() =>
              act("save", async () => {
                const r = await send(`products/${id}`, "PATCH", {
                    variants: changes.map(({ id, priceMinor, compareAtMinor, stock, weightGrams, costMinor }) => ({
                      id,
                      priceMinor,
                      compareAtMinor,
                      stock,
                      ...(p.ships ? { weightGrams } : {}),
                      ...(p.ownStock ? { costMinor } : {}),
                    })),
                  },
                  `Changes to ${p.title}`,
                );
                return r === "queued" ? "Saved. It's sent when you're back online." : "Saved.";
              })
            }
          />
        ) : null}
      </Section>

      {p.ships ? (
        <Section title="Customs">
          <Card>
            <Body muted>Printed on customs forms for orders abroad, and used for duty notes.</Body>
            <Field label="HS code" value={hs} onChangeText={setHs} keyboardType="numbers-and-punctuation" hint="6 to 10 digits, like 6912.00." />
            <Field label="Made in (country code)" value={origin} onChangeText={(t) => setOrigin(t.toUpperCase().slice(0, 2))} autoCapitalize="none" hint="Two letters, like CN or US." />
            <Field
              label="Ships from (country code)"
              value={from}
              onChangeText={(t) => setFrom(t.toUpperCase().slice(0, 2))}
              autoCapitalize="none"
              hint="For a supplier warehouse abroad. Product pages say where it ships from, and duties follow it. Leave it empty when it leaves from your store's country."
            />
            {hs.trim() !== (p.hsCode ?? "") || origin.trim() !== (p.originCountry ?? "") || from.trim() !== (p.shipsFrom ?? "") ? (
              <Button
                label="Save customs details"
                busy={busy === "customs"}
                onPress={() => act("customs", async () => (await api(`products/${id}/customs`, { method: "PUT", body: { hsCode: hs, originCountry: origin, shipsFrom: from } }), "Customs details saved."))}
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {p.giftCard ? null : <VideoSection product={p} busy={busy} act={act} />}
      {p.giftCard ? null : <PersonalizationSection product={p} busy={busy} act={act} />}
      {p.giftCard ? null : <DetailsSection product={p} busy={busy} act={act} />}
      {p.giftCard ? null : <UnitPriceSection product={p} busy={busy} act={act} />}
      {p.swatches && p.swatches.values.length > 1 ? <SwatchesSection product={p} busy={busy} act={act} /> : null}
      {p.status === "draft" ? <LaunchSection product={p} busy={busy} act={act} /> : null}
      <BadgeSection product={p} busy={busy} act={act} />
      {p.images && p.images.length > 0 ? <PhotoTextSection product={p} busy={busy} act={act} /> : null}
      {p.handle ? <AddressSection product={p} busy={busy} act={act} /> : null}
      <TagsSection product={p} busy={busy} act={act} />
      <CollectionsSection product={p} busy={busy} act={act} />
      {p.giftCard ? null : <SentBySection product={p} busy={busy} act={act} />}
      <BackupSection product={p} busy={busy} act={act} currency={cur} />
      <PreorderSection product={p} busy={busy} act={act} />
      <LimitsSection product={p} busy={busy} act={act} />
      {p.giftCard ? null : <BreaksSection product={p} busy={busy} act={act} />}
      {p.giftCard ? null : <ShippingSection product={p} busy={busy} act={act} currency={cur} />}
      {p.giftCard ? null : <AgeSection product={p} busy={busy} act={act} />}
      {p.giftCard ? null : <ReorderSection product={p} busy={busy} act={act} />}

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

type Act = (key: string, fn: () => Promise<string>) => Promise<void>;
const longDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Sold-out options can still be ordered, promised to ship by a date; those orders wait for stock. */
function PreorderSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = { on: !!p.preorder, shipsBy: p.preorder?.shipsBy ?? "", limit: p.preorder?.limit == null ? "" : String(p.preorder.limit) };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const s = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Pre-orders">
      <Card>
        <Body muted>When an option sells out, buyers can still order it, promised to ship by a date. Those orders wait until it's back in stock, then go out like any other.</Body>
        <Toggle label="Take pre-orders when sold out" value={s.on} onChange={(v) => setEdit({ ...s, on: v })} />
        {s.on ? (
          <>
            <Field label="Ships by" value={s.shipsBy} onChangeText={(v) => setEdit({ ...s, shipsBy: v })} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint="As YYYY-MM-DD, tomorrow to 120 days out." />
            <Field label="Most pre-orders (optional)" value={s.limit} onChangeText={(v) => setEdit({ ...s, limit: v })} keyboardType="number-pad" hint="Leave empty for no limit." />
          </>
        ) : null}
        {p.preorder ? (
          <Body>{`${p.preordersSold ?? 0} pre-ordered so far${p.preorder.limit ? ` of ${p.preorder.limit}` : ""}, shipping by ${longDay.format(new Date(`${p.preorder.shipsBy}T12:00:00Z`))}.`}</Body>
        ) : null}
        <Button
          label="Save pre-orders"
          busy={busy === "preorder"}
          disabled={!!busy || !edit}
          onPress={() => act("preorder", async () => (await api<{ message: string }>(`products/${p.id}/preorder`, { method: "PUT", body: s })).message)}
        />
      </Card>
    </Section>
  );
}

/** Shipping for this product: extra days to get it ready, extra shipping for bulky things, and countries it can't go to. */
function ShippingSection({ product: p, busy, act, currency }: { product: Product; busy: string | null; act: Act; currency: string }) {
  const saved = {
    processingDays: p.processingDays == null ? "" : String(p.processingDays),
    surcharge: p.shippingSurchargeMinor ? (p.shippingSurchargeMinor / 100).toFixed(2) : "",
    blockedCountries: (p.blockedCountries ?? []).join(", "),
  };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const s = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const parcel = !p.digital;
  return (
    <Section title="Shipping this product">
      <Card>
        {parcel ? (
          <>
            <Field
              label="Days to get it ready"
              value={s.processingDays}
              onChangeText={(v) => setEdit({ ...s, processingDays: v })}
              keyboardType="number-pad"
              hint="For things made to order or engraved. Leave it empty to use your store's processing days. Delivery dates count it."
            />
            <Field
              label={`Extra shipping for each one (${currency})`}
              value={s.surcharge}
              onChangeText={(v) => setEdit({ ...s, surcharge: v })}
              keyboardType="decimal-pad"
              placeholder="0.00"
              hint="For bulky things like furniture or mirrors. Added to every shipping rate, even free ones. Leave it empty for none."
            />
          </>
        ) : null}
        <Field
          label="Can't ship to (country codes)"
          value={s.blockedCountries}
          onChangeText={(v) => setEdit({ ...s, blockedCountries: v })}
          autoCapitalize="none"
          placeholder="AU, JP"
          hint="Two letters each, with commas, for things like batteries or knives. Buyers there are told before they pay."
        />
        {p.blockedCountryNames?.length ? <Body>{`Doesn't ship to ${p.blockedCountryNames.join(", ")}.`}</Body> : null}
        <Button
          label="Save shipping"
          busy={busy === "shipping"}
          disabled={!!busy || !edit}
          onPress={() => act("shipping", async () => (await api<{ message: string }>(`products/${p.id}/shipping`, { method: "PUT", body: s })).message)}
        />
      </Card>
    </Section>
  );
}

/** The legal minimum age buyers confirm at checkout, for things like alcohol or knives. */
function AgeSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = p.minAge == null ? "" : String(p.minAge);
  const [edit, setEdit] = useState<string | null>(null);
  const v = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Age check">
      <Card>
        <Body muted>For alcohol, vapes, knives and anything else with a legal minimum age. Buyers tick a box at checkout to say they're old enough, and the order shows it so you can ask the courier to check ID.</Body>
        <Field label="Buyers must be at least" value={v} onChangeText={setEdit} keyboardType="number-pad" placeholder="Any age" hint="An age from 13 to 25. Leave it empty for any age." />
        <Button label="Save age check" busy={busy === "age"} disabled={!!busy || edit === null} onPress={() => act("age", async () => (await api<{ message: string }>(`products/${p.id}/min-age`, { method: "PUT", body: { minAge: v } })).message)} />
      </Card>
    </Section>
  );
}

/** One "running low?" email to buyers, this many days after their order arrives, for things that run out. */
function ReorderSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = p.reorderDays == null ? "" : String(p.reorderDays);
  const [edit, setEdit] = useState<string | null>(null);
  const v = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Reorder reminder">
      <Card>
        <Body muted>For things that run out, like coffee, vitamins or refills. That many days after an order arrives, the buyer gets one email asking if they're running low. Not if they've already bought it again.</Body>
        <Field label="It usually lasts (days)" value={v} onChangeText={setEdit} keyboardType="number-pad" placeholder="No reminder" hint="7 to 180 days. Leave it empty for no reminder." />
        <Button label="Save reorder reminder" busy={busy === "reorder"} disabled={!!busy || edit === null} onPress={() => act("reorder", async () => (await api<{ message: string }>(`products/${p.id}/reorder`, { method: "PUT", body: { reorderDays: v } })).message)} />
      </Card>
    </Section>
  );
}

/** A YouTube, Vimeo or video file link shown after the photos on the product page. */
function VideoSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = p.videoUrl ?? "";
  const [edit, setEdit] = useState<string | null>(null);
  const v = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Video">
      <Card>
        <Field
          label="Video link"
          value={v}
          onChangeText={setEdit}
          keyboardType="url"
          autoCapitalize="none"
          placeholder="https://www.youtube.com/watch?v=…"
          hint="A YouTube or Vimeo link, or the address of a video file (many suppliers have one). It shows after the photos. Leave it empty for none."
        />
        <Button label="Save video" busy={busy === "video"} disabled={!!busy || edit === null} onPress={() => act("video", async () => (await api<{ message: string }>(`products/${p.id}/video`, { method: "PUT", body: { url: v } })).message)} />
      </Card>
    </Section>
  );
}

/** Short facts buyers look for, shown as a table under the description. */
function DetailsSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = p.detailsText ?? "";
  const [edit, setEdit] = useState<string | null>(null);
  const v = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Details">
      <Card>
        <Field
          label="Details"
          value={v}
          onChangeText={setEdit}
          multiline
          placeholder={"Material: Aluminium\nSize: 20 × 10 × 8 cm"}
          hint="Like material, size or what's in the box. One per line, label first, then a colon. Up to 20."
        />
        <Button label="Save details" busy={busy === "details"} disabled={!!busy || edit === null} onPress={() => act("details", async () => (await api<{ message: string }>(`products/${p.id}/details`, { method: "PUT", body: { text: v } })).message)} />
      </Card>
    </Section>
  );
}

type PField = { id?: string; label: string; required: boolean; maxLength: string };
const MAX_PERSONAL_FIELDS = 3;

/** Up to three text fields buyers fill in before adding this to their cart, like a name to engrave. */
function PersonalizationSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved: PField[] = (p.personalization ?? []).map((f) => ({ ...f, maxLength: String(f.maxLength) }));
  const [edit, setEdit] = useState<PField[] | null>(null);
  const rows = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const set = (i: number, patch: Partial<PField>) => setEdit(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <Section title="Personalisation">
      <Card>
        <Body muted>Ask buyers for text before they add this to their cart, like a name to engrave. It shows on the order and goes to your supplier with the item. Check that your supplier offers it first.</Body>
        {rows.map((r, i) => (
          <View key={r.id ?? `new-${i}`} style={{ gap: space(2) }} accessibilityRole="none">
            <Field label={`Field ${i + 1} label`} value={r.label} onChangeText={(v) => set(i, { label: v })} placeholder="Name to engrave" />
            <Field label={`Field ${i + 1} most characters`} value={r.maxLength} onChangeText={(v) => set(i, { maxLength: v })} keyboardType="number-pad" />
            <Toggle label={`Field ${i + 1} required`} value={r.required} onChange={(v) => set(i, { required: v })} />
            <Button label={`Remove field ${i + 1}`} kind="ghost" onPress={() => setEdit(rows.filter((_, n) => n !== i))} disabled={!!busy} />
          </View>
        ))}
        {rows.length < MAX_PERSONAL_FIELDS ? (
          <Button label="Add a field" kind="secondary" onPress={() => setEdit([...rows, { label: "", required: true, maxLength: "20" }])} disabled={!!busy} />
        ) : null}
        <Button
          label="Save personalisation"
          busy={busy === "personal"}
          disabled={!!busy || edit === null}
          onPress={() =>
            act("personal", async () => (await api<{ message: string }>(`products/${p.id}/personalization`, { method: "PUT", body: { fields: rows.map((r) => ({ ...r, maxLength: Number(r.maxLength) })) } })).message)
          }
        />
      </Card>
    </Section>
  );
}

// The same units as the website's price-per-unit form (core CONTENT_UNITS).
const CONTENT_UNITS: [string, string][] = [["g", "g"], ["kg", "kg"], ["ml", "ml"], ["cl", "cl"], ["l", "l"], ["cm", "cm"], ["m", "m"], ["m2", "m²"], ["item", "items"]];

/** What one of each option holds, so the store shows the price per kg, litre or metre under the price. */
function UnitPriceSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = Object.fromEntries(p.variants.map((v) => [v.id, { amount: v.contents ? String(v.contents.amount) : "", unit: v.contents?.unit ?? "g" }]));
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const rows = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const single = p.variants.length === 1;
  const set = (id: string, patch: Partial<{ amount: string; unit: string }>) => setEdit({ ...rows, [id]: { ...rows[id]!, ...patch } });
  return (
    <Section title="Price per unit">
      <Card>
        <Body muted>For things sold by weight, volume or length, like coffee, oil or fabric. Say what one holds and the store shows the price per kg, litre or metre under the price, as the EU requires. Leave it empty for anything else.</Body>
        {p.variants.map((v) => (
          <View key={v.id} style={{ gap: space(2) }}>
            <Field label={single ? "Pack contents" : `Pack contents (${v.title})`} value={rows[v.id]?.amount ?? ""} onChangeText={(t) => set(v.id, { amount: t })} keyboardType="decimal-pad" placeholder="250" />
            <Segmented label={single ? "Pack unit" : `Pack unit (${v.title})`} value={rows[v.id]?.unit ?? "g"} onChange={(u) => set(v.id, { unit: u })} options={CONTENT_UNITS} />
          </View>
        ))}
        <Button
          label="Save price per unit"
          busy={busy === "units"}
          disabled={!!busy || edit === null}
          onPress={() =>
            act("units", async () => (await api<{ message: string }>(`products/${p.id}/contents`, { method: "PUT", body: { rows: p.variants.map((v) => ({ variantId: v.id, ...rows[v.id] })) } })).message)
          }
        />
      </Card>
    </Section>
  );
}

/** The merchant's own short label on this product's card and page, like "Bestseller". */
function BadgeSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = p.badge ?? "";
  const [edit, setEdit] = useState<string | null>(null);
  const v = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Badge">
      <Card>
        <Field label="Badge text" value={v} onChangeText={setEdit} placeholder="Bestseller" hint="A short label on this product's card and page, like “Limited edition”. Leave it empty for none." />
        <Button label="Save badge" busy={busy === "badge"} disabled={!!busy || edit === null} onPress={() => act("badge", async () => (await api<{ message: string }>(`products/${p.id}/badge`, { method: "PUT", body: { badge: v } })).message)} />
      </Card>
    </Section>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const spokenTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A draft that goes on sale by itself at a time on this phone's clock, with an optional coming-soon page until then. */
function LaunchSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const at = p.publishAt ? new Date(p.publishAt) : null;
  const saved = at ? { day: `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`, time: `${pad2(at.getHours())}:${pad2(at.getMinutes())}` } : { day: "", time: "09:00" };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const s = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const exact = () => {
    const d = new Date(`${s.day.trim()}T${s.time.trim()}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.day.trim()) || !/^\d{1,2}:\d{2}$/.test(s.time.trim()) || Number.isNaN(d.getTime())) throw new Error("Enter the day like 2026-12-01 and the time like 18:00.");
    return d.toISOString();
  };
  return (
    <Section title="Put on sale later">
      <Card>
        <Body muted>For a launch or a drop you announce ahead: it goes on sale by itself at this time, on your phone's clock.</Body>
        {p.publishAt ? <Body>{`Goes on sale by itself on ${spokenTime(p.publishAt)}. Until then buyers can't see it.`}</Body> : null}
        <Field label="Day" value={s.day} onChangeText={(v) => setEdit({ ...s, day: v })} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" autoCapitalize="none" />
        <Field label="Time" value={s.time} onChangeText={(v) => setEdit({ ...s, time: v })} placeholder="18:00" keyboardType="numbers-and-punctuation" autoCapitalize="none" hint="24-hour, like 18:00." />
        <Button
          label={p.publishAt ? "Change time" : "Schedule"}
          busy={busy === "launch"}
          disabled={!!busy || edit === null}
          onPress={() => act("launch", async () => (await api<{ message: string }>(`products/${p.id}/publish-at`, { method: "PUT", body: { at: exact() } })).message)}
        />
        {p.publishAt ? (
          <>
            <Button label="Cancel schedule" kind="secondary" busy={busy === "unlaunch"} disabled={!!busy} onPress={() => act("unlaunch", async () => (await api<{ message: string }>(`products/${p.id}/publish-at`, { method: "PUT", body: { at: "" } })).message)} />
            <Toggle
              label="Show a coming-soon page"
              value={!!p.comingSoon}
              disabled={!!busy}
              onChange={(on) => void act("soon", async () => (await api<{ message: string }>(`products/${p.id}/coming-soon`, { method: "PUT", body: { on } })).message)}
            />
            <Body muted>At its usual address: the price, a countdown and a box to be emailed the moment it's out.</Body>
          </>
        ) : null}
      </Card>
    </Section>
  );
}

const BREAK_ROWS = 3;

/** Buyers who take more of this product pay less for each one: up to three steps. */
function BreaksSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = Array.from({ length: BREAK_ROWS }, (_, i) => {
    const t = p.quantityBreaks?.[i];
    return { minQty: t ? String(t.minQty) : "", percentOff: t ? String(t.percentOff) : "" };
  });
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const rows = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const set = (i: number, patch: Partial<(typeof saved)[number]>) => setEdit(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <Section title="Quantity discounts">
      <Card>
        <Body muted>Buyers who take more of this product pay less for each one. Different options count together. Wholesale buyers get your wholesale price instead. Leave a row empty to skip it.</Body>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: "row", gap: space(2) }}>
            <View style={{ flex: 1 }}>
              <Field label={`Buy at least (${i + 1})`} value={r.minQty} onChangeText={(v) => set(i, { minQty: v })} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label={`Percent off (${i + 1})`} value={r.percentOff} onChangeText={(v) => set(i, { percentOff: v })} keyboardType="number-pad" />
            </View>
          </View>
        ))}
        <Button
          label="Save quantity discounts"
          busy={busy === "breaks"}
          disabled={!!busy || edit === null}
          onPress={() => act("breaks", async () => (await api<{ message: string }>(`products/${p.id}/quantity-breaks`, { method: "PUT", body: { tiers: rows } })).message)}
        />
      </Card>
    </Section>
  );
}

/** A colour dot for each value of the colour option. Names like "Navy" fill themselves in; the rest are typed as #rrggbb. */
function SwatchesSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const sw = p.swatches!;
  const saved = Object.fromEntries(sw.values.map((v) => [v.value, v.picked ? (v.color ?? "") : ""]));
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const colors = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  const lower = sw.option.toLowerCase();
  return (
    <Section title={`${sw.option} dots`}>
      <Card>
        <Body muted>{`Each ${lower} shows as a dot of that colour on the product page. Common names like Navy or Olive fill themselves in; type the rest like #191970.`}</Body>
        {sw.values.map((v) => {
          const typed = (colors[v.value] ?? "").trim().toLowerCase();
          const shown = /^#[0-9a-f]{6}$/.test(typed) ? typed : typed ? null : v.named;
          return (
            <View key={v.value} style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
              <View
                role="img"
                aria-label={shown ? `${v.value} dot ${shown}` : `${v.value} has no dot`}
                style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: color.border, backgroundColor: shown ?? "transparent" }}
              />
              <View style={{ flex: 1 }}>
                <Field
                  label={`${sw.option} ${v.value}`}
                  value={colors[v.value] ?? ""}
                  onChangeText={(t) => setEdit({ ...colors, [v.value]: t })}
                  autoCapitalize="none"
                  placeholder={v.named ?? "#cccccc"}
                  hint={v.named ? `Empty uses its name's colour, ${v.named}.` : "Empty shows it as words only."}
                />
              </View>
            </View>
          );
        })}
        <Button label="Save colours" busy={busy === "swatches"} disabled={!!busy || edit === null} onPress={() => act("swatches", async () => (await api<{ message: string }>(`products/${p.id}/swatches`, { method: "PUT", body: { colors } })).message)} />
      </Card>
    </Section>
  );
}

type SentBy = { giftCard: boolean; api: string | null; current: string; own: { id: string; name: string }[] };

/** Who sends this product: the supplier it came from, you, or one of your own suppliers by email. */
function SentBySection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  // Asked again whenever the product changes, so a save shows the new pick.
  const data = useApi<SentBy>(`products/${p.id}/sent-by?v=${encodeURIComponent(p.updatedAt ?? "")}`);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(null), [p]);
  const d = data.data;
  if (!d) return null;
  const chosen = pick ?? d.current;
  const choices: [string, string][] = [...(d.api ? [["api", d.api] as [string, string]] : []), ["", "Me (I add tracking myself)"], ...d.own.map((o) => [o.id, o.name] as [string, string])];
  return (
    <Section title="Who sends it">
      <Card>
        <Body muted>
          {d.api
            ? `Orders go to ${d.api} automatically. Pick one of your own suppliers to send it instead; that stops ${d.api} orders for this product.`
            : d.own.length
              ? "Paid orders for this product are emailed to the supplier you pick, with a link where they add tracking."
              : "Add your own suppliers under Suppliers in Settings to have them send this product."}
        </Body>
        {d.own.length ? (
          <>
            <List>
              {choices.map(([id, name]) => (
                <Row key={id || "me"} title={name} a11y={`Sent by ${name}${chosen === id ? ", picked" : ""}`} onPress={() => setPick(id)} right={chosen === id ? <Pill label="Picked" tone="success" /> : null} />
              ))}
            </List>
            <Button
              label="Save who sends it"
              busy={busy === "sentby"}
              disabled={!!busy || pick === null || pick === d.current}
              onPress={() => act("sentby", async () => (await api<{ message: string }>(`products/${p.id}/sent-by`, { method: "PUT", body: { supplierId: chosen } })).message)}
            />
          </>
        ) : null}
      </Card>
    </Section>
  );
}

/** What each photo shows, read out to screen readers and given to image search. Empty uses the product's name. */
/** The product's web address: something short that buyers and search engines understand. */
function AddressSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const [edit, setEdit] = useState<string | null>(null);
  useEffect(() => setEdit(null), [p.handle]);
  const value = edit ?? p.handle ?? "";
  return (
    <Section title="Web address">
      <Card>
        <Body muted>Change it to something short that buyers and search engines understand. Old links keep working.</Body>
        <Field label="Address" value={value} onChangeText={setEdit} autoCapitalize="none" hint={`${p.addressPrefix ?? "/products/"}${value}`} />
        <Button
          label="Save address"
          busy={busy === "handle"}
          disabled={!!busy || edit === null || !value.trim()}
          onPress={() => act("handle", async () => (await api<{ message: string }>(`products/${p.id}/handle`, { method: "PUT", body: { handle: value } })).message)}
        />
      </Card>
    </Section>
  );
}

function PhotoTextSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const photos = p.images ?? [];
  const saved = photos.map((src) => p.imageAlts?.[src] ?? "");
  const [edit, setEdit] = useState<string[] | null>(null);
  const texts = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Describe each photo">
      <Card>
        <Body muted>{`Say what each photo shows, like "Lamp lit up on a bedside table". Screen readers read it out and image search uses it. Empty ones use "${p.title}". Up to 125 characters.`}</Body>
        {photos.map((src, i) => (
          <View key={src} style={{ flexDirection: "row", gap: space(3), alignItems: "center" }}>
            <Image source={{ uri: src }} accessibilityLabel={`Photo ${i + 1}`} style={{ width: 56, height: 56, borderRadius: radius.md, backgroundColor: color.sunken }} />
            <View style={{ flex: 1 }}>
              <Field label={`Photo ${i + 1}${i === 0 ? " (main)" : ""}`} value={texts[i] ?? ""} onChangeText={(t) => setEdit(texts.map((x, n) => (n === i ? t : x)))} />
            </View>
          </View>
        ))}
        <Button label="Save descriptions" busy={busy === "alts"} disabled={!!busy || edit === null} onPress={() => act("alts", async () => (await api<{ message: string }>(`products/${p.id}/photo-texts`, { method: "PUT", body: { texts } })).message)} />
      </Card>
    </Section>
  );
}

/** The least and most a buyer can order of this product, per order and over all their orders. */
function LimitsSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const l = p.purchaseLimit;
  const saved = { min: l?.min == null ? "" : String(l.min), max: l?.max == null ? "" : String(l.max), perCustomer: l?.perCustomer == null ? "" : String(l.perCustomer) };
  const [edit, setEdit] = useState<typeof saved | null>(null);
  const s = edit ?? saved;
  useEffect(() => setEdit(null), [p]);
  return (
    <Section title="Purchase limits">
      <Card>
        <Body muted>For limited runs, or things sold in sets. Leave a box empty for no limit.</Body>
        <Field label="Least per order" value={s.min} onChangeText={(v) => setEdit({ ...s, min: v })} keyboardType="number-pad" />
        <Field label="Most per order" value={s.max} onChangeText={(v) => setEdit({ ...s, max: v })} keyboardType="number-pad" />
        <Field label="Most per customer" value={s.perCustomer} onChangeText={(v) => setEdit({ ...s, perCustomer: v })} keyboardType="number-pad" hint="Counts what they bought before, by email." />
        <Button
          label="Save limits"
          busy={busy === "limits"}
          disabled={!!busy || !edit}
          onPress={() => act("limits", async () => (await api<{ message: string }>(`products/${p.id}/limits`, { method: "PUT", body: s })).message)}
        />
      </Card>
    </Section>
  );
}

/** The product's tags: what list filters, collections that fill by tag and tagged codes go by. */
function TagsSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const saved = (p.tags ?? []).join(", ");
  const [text, setText] = useState<string | null>(null);
  const value = text ?? saved;
  useEffect(() => setText(null), [p]);
  const have = new Set(value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean));
  const others = (p.storeTags ?? []).filter((t) => !have.has(t)).slice(0, 12);
  return (
    <Section title="Tags">
      <Card>
        <Field label="Tags" value={value} onChangeText={setText} autoCapitalize="none" placeholder="summer, gift idea" hint={`Separate them with commas. Up to ${p.maxTags ?? 20}.`} />
        {others.length ? (
          <View role="group" aria-label="Your other tags" style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2) }}>
            {others.map((t) => (
              <Button key={t} label={`+ ${t}`} kind="ghost" a11y={`Add the tag ${t}`} onPress={() => setText(value.trim() ? `${value.replace(/,\s*$/, "")}, ${t}` : t)} />
            ))}
          </View>
        ) : null}
        <Button
          label="Save tags"
          busy={busy === "tags"}
          disabled={!!busy || text === null || text === saved}
          onPress={() => act("tags", async () => (await api(`products/${p.id}`, { method: "PATCH", body: { tags: value } }), "Tags saved."))}
        />
      </Card>
    </Section>
  );
}

/** Which collections the product is in. Hand-picked ones switch here; automatic ones fill by their rules. */
function CollectionsSection({ product: p, busy, act }: { product: Product; busy: string | null; act: Act }) {
  const can = useCan();
  const all = p.collections ?? [];
  const manual = all.filter((c) => !c.auto);
  if (!can("collections")) return null;
  const auto = all.filter((c) => c.auto);
  return (
    <Section title="Collections">
      <Card>
        {!all.length ? <Body muted>No collections yet. Make them on the website, then put products in them here.</Body> : null}
        {manual.length ? (
          <View role="group" aria-label="Hand-picked collections">
            {manual.map((c) => (
              <Toggle
                key={c.id}
                label={c.title}
                value={c.in}
                onChange={(v) => {
                  if (busy) return;
                  void act(`collection-${c.id}`, async () => (await api<{ message: string }>(`products/${p.id}/collections/${c.id}`, { method: "PUT", body: { in: v } })).message);
                }}
              />
            ))}
          </View>
        ) : null}
        {auto.length ? (
          <View role="group" aria-label="Automatic collections" style={{ gap: space(2) }}>
            <Body muted>These fill by themselves from their rules.</Body>
            {auto.map((c) => (
              <View key={c.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2) }}>
                <Body>{c.title}</Body>
                <Pill label={c.in ? "In it" : "Not in it"} tone={c.in ? "success" : "neutral"} />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </Section>
  );
}

/** A backup supplier: the same product at a second supplier, so an order goes there when the main one runs out. */
function BackupSection({ product: p, busy, act, currency }: { product: Product; busy: string | null; act: Act; currency: string }) {
  const [url, setUrl] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [p]);
  const b = p.backup;
  if (!b?.possible) return null;
  return (
    <Section title="Backup supplier">
      <Card>
        {b.link ? (
          <>
            {b.link.gone ? <Banner tone="warning">The backup listing was taken down. Add another one.</Banner> : null}
            <Body>Orders go to the backup when the main supplier is out of stock, and its stock counts toward yours.</Body>
            <View role="list" aria-label="Backup options" style={{ gap: space(1) }}>
              {b.link.options.map((o) => (
                <View key={o.title} role="listitem">
                  <Body>{o.covered ? `${o.title}: costs ${money(o.costMinor ?? 0, currency)}${o.stock === null ? "" : `, ${o.stock} in stock`}` : `${o.title}: no match there`}</Body>
                </View>
              ))}
            </View>
            {confirm ? (
              <Button label="Remove backup" kind="danger" busy={busy === "backup"} disabled={!!busy} onPress={() => act("backup", async () => (await api<{ message: string }>(`products/${p.id}/backup`, { method: "DELETE" })).message)} />
            ) : (
              <Button label="Remove backup…" kind="ghost" disabled={!!busy} onPress={() => setConfirm(true)} />
            )}
          </>
        ) : (
          <>
            <Body muted>Paste a second supplier's link to the same product. When the main supplier runs out, orders go there instead of becoming a problem.</Body>
            <Field label="Backup supplier link" value={url} onChangeText={setUrl} keyboardType="url" autoCapitalize="none" placeholder="https://" />
            <Button
              label="Add backup"
              busy={busy === "backup"}
              disabled={!!busy || !url.trim()}
              onPress={() => act("backup", async () => (await api<{ message: string }>(`products/${p.id}/backup`, { method: "PUT", body: { url } })).message)}
            />
          </>
        )}
      </Card>
    </Section>
  );
}
