import Link from "next/link";
import { listOpenAppeals, listStoresForStaff, NOTICE_REASONS } from "@sf/core";
import { requireStaff } from "@/lib/server";
import { DecideAppealForm } from "./StaffForms";

const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const STATUS: Record<string, string> = { active: "pill-success", paused: "pill-critical", under_review: "pill-warning", suspended: "pill-critical", closed: "pill-neutral" };

export default async function StaffHome() {
  const { db } = await requireStaff();
  const [appeals, stores] = await Promise.all([listOpenAppeals(db), listStoresForStaff(db)]);
  return (
    <main className="px-4 sm:px-8 py-6 flex flex-col gap-6 max-w-5xl">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Appeals waiting ({appeals.length})</h1>
        {appeals.length === 0 && <p className="hint">None. Nice.</p>}
        {appeals.map(({ appeal, notice, shop }) => (
          <article key={appeal.id} className="card p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <Link href={`/staff/stores/${shop.id}`} className="font-semibold underline">{shop.name}</Link>
              <span className={`pill ${STATUS[shop.status]}`}>{shop.status}</span>
              <span className="hint">{notice.kind} · {NOTICE_REASONS[notice.reason].title} · appealed {day.format(appeal.createdAt)}</span>
            </div>
            <p className="text-sm"><span className="font-semibold">Our notice: </span>{notice.explanation}</p>
            <p className="text-sm"><span className="font-semibold">Merchant: </span>{appeal.message}</p>
            <DecideAppealForm appealId={appeal.id} />
          </article>
        ))}
      </section>
      <section className="card">
        <h2 className="font-semibold px-5 pt-4 pb-2">Stores</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left hint"><th className="px-5 py-2 font-medium">Store</th><th className="px-5 py-2 font-medium">Status</th><th className="px-5 py-2 font-medium">Plan</th><th className="px-5 py-2 font-medium">Created</th></tr></thead>
          <tbody className="divide-y divide-border">
            {stores.map((s) => (
              <tr key={s.id}>
                <td className="px-5 py-3"><Link className="underline" href={`/staff/stores/${s.id}`}>{s.name}</Link>{s.verifiedAt && <span className="pill pill-success ml-2">Verified</span>}</td>
                <td className="px-5 py-3"><span className={`pill ${STATUS[s.status]}`}>{s.status}</span></td>
                <td className="px-5 py-3">{s.plan}</td>
                <td className="px-5 py-3 num">{day.format(s.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
