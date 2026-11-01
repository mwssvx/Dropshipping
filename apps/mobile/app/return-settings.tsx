import { useState } from "react";
import { api, useApi } from "../src/api";
import { BackLink, Banner, Body, Button, Card, Field, LoadError, Loading, Screen } from "../src/ui";

type Data = { windowDays: number; instructions: string; placeholder: string };

/** How many days after delivery buyers can ask for a return, and what they're told to do once it's approved. */
export default function ReturnSettingsScreen() {
  const data = useApi<Data>("return-settings");
  const [edit, setEdit] = useState<{ windowDays: string; instructions: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const d = data.data;
  const v = edit ?? (d ? { windowDays: String(d.windowDays), instructions: d.instructions } : null);

  async function save() {
    if (!v) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api<{ message: string }>("return-settings", { method: "PUT", body: v });
      setNote({ tone: "success", text: res.message });
      setEdit(null);
      await data.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Return settings" back={<BackLink href="/returns" label="Returns" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d || !v ? (
        data.loading ? <Loading /> : null
      ) : (
        <Card>
          <Field
            label="Days buyers have to ask"
            value={v.windowDays}
            onChangeText={(t) => setEdit({ ...v, windowDays: t })}
            keyboardType="number-pad"
            hint="Counted from delivery. 0 turns off the return form; buyers then email you instead."
          />
          <Field
            label="What buyers do after you approve"
            value={v.instructions}
            onChangeText={(t) => setEdit({ ...v, instructions: t })}
            placeholder={d.placeholder}
            multiline
            hint="Sent with every approval, unless you write something else on that return. For cheap items, many stores say “Keep it” and refund straight away."
          />
          {v.instructions.trim() ? null : <Body muted>Left empty, buyers get the wording shown in the box.</Body>}
          <Button label="Save return settings" busy={busy} disabled={busy || !edit} onPress={() => void save()} />
        </Card>
      )}
    </Screen>
  );
}
