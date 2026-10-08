import Link from "next/link";
import { listTeam, PLANS, ROLES } from "@sf/core";
import { requireShop } from "@/lib/server";
import { cancelInviteAction, changeRoleAction, leaveStoreAction, removeMemberAction, resendInviteAction } from "../../team-actions";
import { PageHeader } from "../PageHeader";
import { InviteForm, TransferForm } from "./TeamForms";

export const metadata = { title: "Team" };

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ handed?: string }> }) {
  const { shop, db, user, role } = await requireShop();
  const { handed } = await searchParams;
  const { members, invites } = await listTeam(db, shop.id);
  const owner = role === "owner";
  const seats = PLANS[shop.plan].teamSeats;
  const used = members.filter((m) => m.role !== "owner").length + invites.length;
  const others = members.filter((m) => m.role !== "owner");

  return (
    <main className="pb-12">
      <PageHeader title="Team" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        {handed && <p className="banner banner-success" role="status">You handed the store over. You&apos;re an admin now.</p>}
        <p className="hint">
          Give people their own sign-in instead of sharing yours. Each role only sees what it needs, and you can change or remove
          anyone at any time.
        </p>

        <section className="card p-5 flex flex-col gap-4" aria-labelledby="members-heading">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 id="members-heading" className="font-semibold">People</h2>
            {seats > 0 && <span className="hint text-sm">{used} of {seats} staff accounts used</span>}
          </div>
          <ul className="divide-y divide-border border-y border-border">
            {members.map((m) => (
              <li key={m.userId} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label={m.email}>
                <span className="flex-1 min-w-48 flex flex-col">
                  <span className="font-medium">{m.name || m.email}{m.userId === user.id && <span className="hint"> (you)</span>}</span>
                  {m.name && <span className="hint">{m.email}</span>}
                </span>
                {owner && m.role !== "owner" ? (
                  <form action={changeRoleAction.bind(null, m.userId)} className="flex gap-2 items-center">
                    <label className="sr-only" htmlFor={`role-${m.userId}`}>Role for {m.email}</label>
                    <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="input text-sm w-auto">
                      <option value="admin">Admin</option>
                      <option value="staff">Staff</option>
                    </select>
                    <button className="btn btn-secondary">Save</button>
                  </form>
                ) : (
                  <span className={`pill ${m.role === "owner" ? "pill-info" : "pill-neutral"}`}>{ROLES[m.role].name}</span>
                )}
                {owner && m.role !== "owner" && (
                  <form action={removeMemberAction.bind(null, m.userId)}>
                    <button className="hint hover:text-critical" aria-label={`Remove ${m.email}`}>Remove</button>
                  </form>
                )}
              </li>
            ))}
            {invites.map((i) => (
              <li key={i.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label={`Invite for ${i.email}`}>
                <span className="flex-1 min-w-48 flex flex-col">
                  <span className="font-medium">{i.email}</span>
                  <span className="hint">Invited {day(i.createdAt)} · link works until {day(i.expiresAt)}</span>
                </span>
                <span className="pill pill-warning">Invited as {ROLES[i.role].name.toLowerCase()}</span>
                {owner && (
                  <>
                    <form action={resendInviteAction.bind(null, i.email, i.role)}><button className="hint hover:text-ink">Send again</button></form>
                    <form action={cancelInviteAction.bind(null, i.id)}><button className="hint hover:text-critical" aria-label={`Cancel invite for ${i.email}`}>Cancel</button></form>
                  </>
                )}
              </li>
            ))}
          </ul>

          {owner && (seats === 0 ? (
            <div className="banner banner-info flex flex-wrap items-center justify-between gap-3">
              <span>Staff accounts come with the Scale plan: up to {PLANS.scale.teamSeats} people besides you, each with their own sign-in.</span>
              <Link className="btn btn-secondary" href="/admin/plan">See plans</Link>
            </div>
          ) : used >= seats ? (
            <p className="hint">All {seats} staff accounts are in use. Remove someone or cancel an invite to add another person.</p>
          ) : (
            <InviteForm />
          ))}
          {!owner && (
            <form action={leaveStoreAction} className="flex items-center justify-between gap-3 flex-wrap">
              <span className="hint">Only the owner can invite or remove people.</span>
              <button className="btn btn-secondary">Leave this store</button>
            </form>
          )}
        </section>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="roles-heading">
          <h2 id="roles-heading" className="font-semibold">What each role can do</h2>
          <dl className="grid sm:grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
            {(Object.keys(ROLES) as (keyof typeof ROLES)[]).map((r) => (
              <div key={r} className="contents">
                <dt className="font-medium">{ROLES[r].name}</dt>
                <dd className="hint">{ROLES[r].summary}</dd>
              </div>
            ))}
          </dl>
        </section>

        {owner && others.length > 0 && (
          <section className="card p-5 flex flex-col gap-3" aria-labelledby="transfer-heading">
            <h2 id="transfer-heading" className="font-semibold">Hand over the store</h2>
            <p className="hint text-sm">Make someone on the team the owner, for example if you sell the business. You stay on as an admin; only the new owner can change that.</p>
            <TransferForm people={others.map((m) => ({ id: m.userId, label: m.name ? `${m.name} (${m.email})` : m.email }))} />
          </section>
        )}
      </div>
    </main>
  );
}
