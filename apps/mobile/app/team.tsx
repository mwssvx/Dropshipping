import { useState } from "react";
import { View } from "react-native";
import { api, useApi } from "../src/api";
import { when } from "../src/format";
import { BackLink, Banner, Body, Button, Card, Field, Heading, LoadError, Loading, Pill, Screen, Section, Segmented } from "../src/ui";
import { space } from "../src/theme";

type Role = "owner" | "admin" | "staff";
type Team = {
  plan: string;
  seats: number;
  used: number;
  roles: { admin: string; staff: string };
  members: { userId: string; email: string; name: string | null; role: Role; since: string; you: boolean }[];
  invites: { id: string; email: string; role: "admin" | "staff"; expiresAt: string }[];
};
const ROLE: Record<Role, string> = { owner: "Owner", admin: "Admin", staff: "Staff" };

/** Who helps run the store: invite someone, change what they can do, or take them off the team. */
export default function TeamScreen() {
  const team = useApi<Team>("team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function run(key: string, path: string, init: { method?: string; body?: unknown }) {
    setBusy(key);
    setNote(null);
    try {
      const r = await api<{ message: string }>(path, init);
      setNote({ tone: "success", text: r.message });
      setOpen(null);
      if (key === "invite") setEmail("");
      await team.reload();
    } catch (e) {
      setNote({ tone: "critical", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const t = team.data;
  return (
    <Screen title="Team" back={<BackLink href="/settings" label="Settings" />} onRefresh={team.reload} refreshing={team.loading && !!t}>
      {note ? <Banner tone={note.tone}>{note.text}</Banner> : null}
      <LoadError error={team.error} stale={team.stale} retry={team.reload} />
      {!t ? (
        team.loading ? <Loading /> : null
      ) : (
        <>
          {t.seats === 0 ? (
            <Banner tone="info">{`The ${t.plan} plan is just you. Staff accounts come with the Scale plan, which you can switch to on the website under Plan.`}</Banner>
          ) : (
            <Card>
              <Heading>Invite someone</Heading>
              <Body muted>{`${t.used} of ${t.seats} staff accounts used. They get an email with a link to join, which works for a week.`}</Body>
              <Field label="Their email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Segmented
                label="Role"
                value={role}
                onChange={setRole}
                options={[
                  ["staff", "Staff"],
                  ["admin", "Admin"],
                ]}
              />
              <Body muted>{t.roles[role]}</Body>
              <Button label="Send invite" busy={busy === "invite"} disabled={!email.trim() || !!busy} onPress={() => run("invite", "team/invites", { body: { email, role } })} />
            </Card>
          )}

          <Section title="People">
            {t.members.map((m) => (
              <Card key={m.userId}>
                <View role="article" aria-label={m.name || m.email} style={{ gap: space(2) }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space(2) }}>
                    <Body>{m.you ? `${m.name || m.email} (you)` : m.name || m.email}</Body>
                    <Pill label={ROLE[m.role]} tone={m.role === "owner" ? "info" : "neutral"} />
                  </View>
                  <Body muted>{[m.name ? m.email : null, `Since ${when(m.since)}`].filter(Boolean).join(" · ")}</Body>
                  {m.role !== "owner" && !m.you ? (
                    open === m.userId ? (
                      <>
                        <Button
                          label={m.role === "staff" ? "Make admin" : "Make staff"}
                          kind="secondary"
                          busy={busy === `role-${m.userId}`}
                          disabled={!!busy}
                          onPress={() => run(`role-${m.userId}`, `team/members/${m.userId}`, { method: "PATCH", body: { role: m.role === "staff" ? "admin" : "staff" } })}
                        />
                        <Button label={`Remove ${m.email}`} kind="danger" busy={busy === `rm-${m.userId}`} disabled={!!busy} onPress={() => run(`rm-${m.userId}`, `team/members/${m.userId}`, { method: "DELETE" })} />
                        <Button label="Done" kind="ghost" onPress={() => setOpen(null)} />
                      </>
                    ) : (
                      <Button label="Change…" kind="ghost" a11y={`Change ${m.email}…`} onPress={() => setOpen(m.userId)} />
                    )
                  ) : null}
                </View>
              </Card>
            ))}
          </Section>

          {t.invites.length ? (
            <Section title="Invites waiting">
              {t.invites.map((i) => (
                <Card key={i.id}>
                  <View role="article" aria-label={`Invite for ${i.email}`} style={{ gap: space(2) }}>
                    <Body>{i.email}</Body>
                    <Body muted>{`Invited as ${i.role} · the link works until ${when(i.expiresAt)}`}</Body>
                    <View style={{ flexDirection: "row", gap: space(2), flexWrap: "wrap" }}>
                      <Button label="Send again" kind="secondary" disabled={!!busy} busy={busy === `again-${i.id}`} onPress={() => run(`again-${i.id}`, "team/invites", { body: { email: i.email, role: i.role } })} />
                      <Button label="Cancel invite" kind="ghost" a11y={`Cancel the invite for ${i.email}`} disabled={!!busy} busy={busy === `cancel-${i.id}`} onPress={() => run(`cancel-${i.id}`, `team/invites/${i.id}`, { method: "DELETE" })} />
                    </View>
                  </View>
                </Card>
              ))}
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
