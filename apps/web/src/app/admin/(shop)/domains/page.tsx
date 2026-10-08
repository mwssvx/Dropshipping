import { dnsRecordsFor, listDomains } from "@sf/core";
import { domains as domainContext, requireShop, storeUrl } from "@/lib/server";
import { makePrimaryDomainAction, removeDomainAction } from "../../store-actions";
import { PageHeader } from "../PageHeader";
import { AddDomainForm, CheckDomainButton } from "./DomainActions";

export const metadata = { title: "Domains" };

export default async function DomainsPage() {
  const { shop, db } = await requireShop("domains");
  const [list, ctx] = await Promise.all([listDomains(db, shop.id), domainContext()]);
  const platform = storeUrl(shop.handle).replace(/^https?:\/\//, "");
  return (
    <main className="pb-12">
      <PageHeader title="Domains" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <section className="card p-5 flex flex-col gap-2">
          <h2 className="font-semibold">Your free address</h2>
          <p className="num">{platform}</p>
          <p className="hint">This always works, even after you connect your own domain.</p>
        </section>

        <section className="card p-5 flex flex-col gap-4">
          <h2 className="font-semibold">Your own domain</h2>
          <AddDomainForm />
        </section>

        {list.map((d) => {
          const connected = !!d.verifiedAt && !d.lastError;
          const record = dnsRecordsFor(d.hostname, ctx.targets)[0]!;
          return (
            <section key={d.id} className="card p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <h3 className="font-semibold truncate">{d.hostname}</h3>
                  {connected ? <span className="pill pill-success">Connected</span> : d.verifiedAt ? <span className="pill pill-warning">Needs attention</span> : <span className="pill pill-warning">Waiting for DNS</span>}
                  {d.isPrimary && <span className="pill pill-info">Main address</span>}
                </div>
                <div className="flex gap-2">
                  {connected && !d.isPrimary && (
                    <form action={makePrimaryDomainAction.bind(null, d.id)}><button className="btn btn-secondary">Make main address</button></form>
                  )}
                  <form action={removeDomainAction.bind(null, d.id)}><button className="btn btn-secondary text-critical">Remove</button></form>
                </div>
              </div>
              {!connected && (
                <>
                  <ol className="flex flex-col gap-3 text-sm list-decimal pl-5">
                    <li>Sign in where you bought <strong>{d.hostname}</strong> and open its DNS settings.</li>
                    <li>
                      Add this record. If there's already an {record.type} record with the same name, edit it instead.
                      <div className="card mt-2 overflow-x-auto">
                        <table className="table">
                          <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                          <tbody><tr><td className="num">{record.type}</td><td className="num">{record.name}</td><td className="num select-all">{record.value}</td></tr></tbody>
                        </table>
                      </div>
                    </li>
                    <li>Come back and press Check now. Changes usually show up within an hour, and can take up to 48.</li>
                  </ol>
                  {d.lastError && <p className="hint">Last check: {d.lastError}</p>}
                  <CheckDomainButton id={d.id} />
                </>
              )}
              {connected && <p className="hint">Buyers can shop at https://{d.hostname}. The security certificate is set up for you.</p>}
            </section>
          );
        })}
      </div>
    </main>
  );
}
