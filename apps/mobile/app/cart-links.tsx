import { useState } from "react";
import { Share, View } from "react-native";
import { api, useApi } from "../src/api";
import { money } from "../src/format";
import { useSession } from "../src/session";
import { BackLink, Banner, Body, Button, Card, EmptyState, Field, Heading, List, LoadError, Loading, Pill, Row, Screen, Section } from "../src/ui";
import { space } from "../src/theme";

type Link = {
  id: string;
  name: string;
  url: string;
  clicks: number;
  orders: number;
  salesMinor: number;
  items: { quantity: number; title: string; onSale: boolean }[];
  discountCode: string | null;
};
type Option = { id: string; title: string; draft: boolean };
type Data = { max: number; links: Link[]; options: Option[]; codes: string[] };

const many = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * One link that fills a shopper's cart with the products (and code) you pick, then opens the cart.
 * Make one on the phone and share it straight into a DM, a story or a creator's chat.
 */
export default function CartLinksScreen() {
  const data = useApi<Data>("cart-links");
  const cur = useSession().me?.shop.currency ?? "USD";
  const [name, setName] = useState("");
  const [find, setFind] = useState("");
  const [lines, setLines] = useState<{ option: Option; quantity: number }[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;

  const share = (name: string, url: string) => void Share.share({ message: `${name}: ${url}`, url });

  async function make() {
    setBusy("make");
    setNote(null);
    try {
      const r = await api<{ message: string; url: string }>("cart-links", {
        body: { name, discountCode: code, lines: lines.map((l) => ({ variantId: l.option.id, quantity: l.quantity })) },
      });
      setNote({ tone: "success", text: r.message });
      setName("");
      setLines([]);
      setCode(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(l: Link) {
    setBusy(`del:${l.id}`);
    setNote(null);
    try {
      const r = await api<{ message: string }>(`cart-links/${l.id}`, { method: "DELETE" });
      setNote({ tone: "success", text: r.message });
      setConfirm(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const term = find.trim().toLowerCase();
  const matches = d && term ? d.options.filter((o) => o.title.toLowerCase().includes(term) && !lines.some((l) => l.option.id === o.id)).slice(0, 6) : [];
  const qty = (id: string, by: number) => setLines(lines.flatMap((l) => (l.option.id !== id ? [l] : l.quantity + by > 0 ? [{ ...l, quantity: Math.min(99, l.quantity + by) }] : [])));

  return (
    <Screen title="Cart links" back={<BackLink href="/" label="Today" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>One link that puts the products you pick in a shopper's cart, with a code if you like. Anything sold out when they open it is left out.</Body>
          {d.links.length ? (
            <Section title="Your cart links">
              {d.links.map((l) => (
                <Card key={l.id}>
                  <View role="group" aria-label={l.name} style={{ gap: space(1) }}>
                    <Heading>{l.name}</Heading>
                    <Body muted>{`${many(l.clicks, "click")} · ${many(l.orders, "order")} · ${money(l.salesMinor, cur)}`}</Body>
                    {l.items.map((i, k) => (
                      <Body key={k}>{`${i.quantity} × ${i.title}${i.onSale ? "" : " (not on sale, left out)"}`}</Body>
                    ))}
                    {l.discountCode ? <Body>{`Code ${l.discountCode}`}</Body> : null}
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button label="Share" onPress={() => share(l.name, l.url)} a11y={`Share ${l.name}`} />
                      {confirm === l.id ? (
                        <Button label={`Delete ${l.name}`} kind="danger" busy={busy === `del:${l.id}`} disabled={!!busy} onPress={() => remove(l)} />
                      ) : (
                        <Button label="Delete…" kind="secondary" onPress={() => setConfirm(l.id)} a11y={`Delete ${l.name}…`} />
                      )}
                    </View>
                  </View>
                </Card>
              ))}
            </Section>
          ) : null}
          <Section title="New cart link">
            {d.options.length === 0 ? (
              <EmptyState heading="No products yet" body="Add a product first, then make a link for it." />
            ) : (
              <Card>
                <Field label="Link name" value={name} onChangeText={setName} placeholder="Instagram bundle" hint="Only you see it. Sales from the link are counted under this name." />
                {lines.length ? (
                  <List>
                    {lines.map((l) => (
                      <View key={l.option.id} role="group" aria-label={`In the cart: ${l.option.title}`} style={{ gap: space(1), padding: space(3) }}>
                        <Body>{l.option.title}</Body>
                        <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
                          <Button label="−" kind="secondary" a11y={`One fewer ${l.option.title}`} onPress={() => qty(l.option.id, -1)} />
                          <Body>{`${l.quantity}`}</Body>
                          <Button label="+" kind="secondary" a11y={`One more ${l.option.title}`} onPress={() => qty(l.option.id, 1)} />
                        </View>
                      </View>
                    ))}
                  </List>
                ) : null}
                {lines.length < d.max ? (
                  <>
                    <Field label="Add a product" value={find} onChangeText={setFind} placeholder="Type part of its name" autoCapitalize="none" />
                    {matches.length ? (
                      <List>
                        {matches.map((o) => (
                          <Row
                            key={o.id}
                            title={o.title}
                            right={o.draft ? <Pill label="Draft" /> : undefined}
                            a11y={`Add ${o.title}`}
                            onPress={() => {
                              setLines([...lines, { option: o, quantity: 1 }]);
                              setFind("");
                            }}
                          />
                        ))}
                      </List>
                    ) : term ? (
                      <Body muted>No product matches.</Body>
                    ) : null}
                  </>
                ) : (
                  <Body muted>{`A cart link holds up to ${d.max} products.`}</Body>
                )}
                {d.codes.length ? (
                  <>
                    <Body>{code ? `Code: ${code}` : "No code"}</Body>
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      {code ? <Button label="No code" kind="ghost" onPress={() => setCode(null)} /> : null}
                      {d.codes.filter((c) => c !== code).slice(0, 8).map((c) => (
                        <Button key={c} label={c} kind="secondary" a11y={`Use the code ${c}`} onPress={() => setCode(c)} />
                      ))}
                    </View>
                  </>
                ) : null}
                <Button label="Make the link" busy={busy === "make"} disabled={!!busy || !lines.length || !name.trim()} onPress={make} />
              </Card>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
