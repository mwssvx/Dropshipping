import { LAUNCH_TASKS, launchChecks } from "@sf/core";
import { requireStaff } from "@/lib/server";

export const metadata = { title: "Launch checklist" };
export const dynamic = "force-dynamic";

/** The launch preflight against this deployment's own settings. Same checks as `pnpm preflight`. */
export default async function LaunchPage() {
  await requireStaff();
  const checks = launchChecks(process.env);
  const blocking = checks.filter((c) => !c.ok && c.severity === "blocker");
  const areas = [...new Set(checks.map((c) => c.area))];
  return (
    <main className="px-4 sm:px-8 py-6 flex flex-col gap-6 max-w-3xl">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Launch checklist</h1>
        <p className={`banner ${blocking.length ? "banner-warning" : "banner-success"}`} role="status">
          {blocking.length ? `${blocking.length} ${blocking.length === 1 ? "setting is" : "settings are"} blocking launch on this deployment.` : "Nothing in this deployment's settings is blocking launch."}
        </p>
      </div>
      {areas.map((area) => (
        <section key={area} className="card p-5 flex flex-col gap-3" aria-labelledby={`area-${area}`}>
          <h2 id={`area-${area}`} className="font-semibold">{area}</h2>
          <ul className="flex flex-col gap-3">
            {checks.filter((c) => c.area === area).map((c) => (
              <li key={c.id} className="flex gap-3 text-sm">
                <span className={`pill shrink-0 self-start ${c.ok ? "pill-success" : c.severity === "blocker" ? "pill-critical" : "pill-warning"}`}>
                  {c.ok ? "Ready" : c.severity === "blocker" ? "Blocking" : "Missing"}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{c.label}</span>
                  {!c.ok && <span className="hint">{c.fix}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="card p-5 flex flex-col gap-3" aria-labelledby="people">
        <h2 id="people" className="font-semibold">Done by a person</h2>
        <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm">
          {LAUNCH_TASKS.map((t) => <li key={t}>{t}</li>)}
        </ol>
      </section>
    </main>
  );
}
