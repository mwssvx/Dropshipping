import { useState } from "react";
import { Share } from "react-native";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, List, LoadError, Loading, Row, Screen, Section, Segmented } from "../src/ui";

type Link = { label: string; url: string };
type Pixels = { meta: string; tiktok: string; google: string; pinterest: string; consent: "everyone" | "eu_uk" };
type Data = {
  products: number;
  options: number;
  withBarcode: number;
  feeds: { id: string; name: string; links: Link[]; steps: string }[];
  reviews: { published: number; url: string };
  issues: { productId: string; title: string; problem: string }[];
  pixels: Pixels;
};

/** Feed links for Google Shopping, Facebook and Instagram, Pinterest and TikTok, what's left out, and ad tracking tags. */
export default function ChannelsScreen() {
  const data = useApi<Data>("channels");
  const [pixels, setPixels] = useState<Pixels | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const px = pixels ?? d?.pixels ?? null;
  const share = (name: string, l: Link) => void Share.share({ message: l.url, url: l.url, title: `${name} ${l.label.toLowerCase()}` });

  async function save() {
    if (!px) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api<{ message: string }>("channels/pixels", { method: "PUT", body: px });
      setNote({ tone: "success", text: r.message });
      setPixels(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Sales channels" back={<BackLink href="/settings" label="Settings" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !px ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>Each channel reads a feed from your store once a day, so new products, prices, sales and stock follow by themselves. Send yourself a link and paste it in the channel on a computer. Gift cards aren't listed.</Body>
          <Body>
            {`${d.products} ${d.products === 1 ? "product" : "products"} (${d.options} ${d.options === 1 ? "option" : "options"}) in your feeds${d.issues.length ? `, ${d.issues.length} ${d.issues.length === 1 ? "thing" : "things"} to fix below.` : "."}${d.options ? ` ${d.withBarcode} of ${d.options} have a barcode.` : ""}`}
          </Body>
          {d.feeds.map((f) => (
            <Section key={f.id} title={f.name}>
              <List>
                {f.links.map((l) => (
                  <Row key={l.url} title={l.label} subtitle={l.url} onPress={() => share(f.name, l)} a11y={`Share the ${f.name} ${l.label.toLowerCase()}`} />
                ))}
              </List>
              <Body muted>{f.steps}</Body>
            </Section>
          ))}
          <Section title="Stars in Google Shopping">
            <List>
              <Row title="Product reviews feed link" subtitle={d.reviews.url} onPress={() => share("Google", { label: "Product reviews feed link", url: d.reviews.url })} a11y="Share the Google product reviews feed link" />
            </List>
            <Body muted>{`Google asks for at least 50 reviews in all before it shows stars; you have ${d.reviews.published}. In Merchant Center, turn on Product ratings and send reviews by feed.`}</Body>
          </Section>
          <Section title="To fix">
            {d.issues.length ? (
              <List>
                {d.issues.map((i, n) => (
                  <Row key={`${i.productId}-${n}`} href={`/products/${i.productId}`} title={i.title} subtitle={i.problem} />
                ))}
              </List>
            ) : (
              <Body muted>Nothing. Every product on your store is in the feeds.</Body>
            )}
          </Section>
          <Section title="Ad tracking">
            <Card>
              <Body muted>Paste your pixel and tag IDs so your ads can see what they lead to. Visitors are asked first in a cookie banner, and nothing loads until they agree.</Body>
              <Field label="Meta pixel ID" value={px.meta} onChangeText={(v) => setPixels({ ...px, meta: v })} keyboardType="number-pad" autoCapitalize="none" placeholder="1234567890123456" />
              <Field label="TikTok pixel ID" value={px.tiktok} onChangeText={(v) => setPixels({ ...px, tiktok: v })} autoCapitalize="none" placeholder="CABC123DEF456GHI789J" />
              <Field label="Google tag ID" value={px.google} onChangeText={(v) => setPixels({ ...px, google: v })} autoCapitalize="none" placeholder="G-ABC123DEF4" />
              <Field label="Pinterest tag ID" value={px.pinterest} onChangeText={(v) => setPixels({ ...px, pinterest: v })} keyboardType="number-pad" autoCapitalize="none" placeholder="2612345678901" />
              <Segmented
                label="Ask before tracking"
                value={px.consent}
                onChange={(v) => setPixels({ ...px, consent: v })}
                options={[
                  ["everyone", "Every visitor"],
                  ["eu_uk", "Only where the law requires"],
                ]}
              />
              <Body muted>{px.consent === "eu_uk" ? "Only visitors in the EU, EEA, UK and Switzerland are asked first." : "Every visitor is asked first."}</Body>
              <Button label="Save ad tracking" busy={busy} disabled={busy || !pixels} onPress={save} />
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}
