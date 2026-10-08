import { listApiKeys, listWebhookEndpoints, WEBHOOK_EVENT_LABELS } from "@sf/core";
import { WEBHOOK_EVENTS } from "@sf/db";
import { adminUrl, requireShop } from "@/lib/server";
import { deleteWebhookAction, retryDeliveryAction, revokeApiKeyAction, setWebhookActiveAction } from "../../developer-actions";
import { PageHeader } from "../PageHeader";
import { ApiKeyForm, Secret, TestWebhookButton, WebhookForm } from "./DeveloperForms";

export const metadata = { title: "Developers" };

const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");

export default async function DevelopersPage() {
  const { shop, db } = await requireShop();
  const [keys, endpoints, base] = await Promise.all([listApiKeys(db, shop.id), listWebhookEndpoints(db, shop.id), adminUrl("/api/v1")]);
  const live = keys.filter((k) => !k.revokedAt);

  return (
    <main className="pb-12">
      <PageHeader title="Developers" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          Connect your own tools: read and update orders and products with an API key, and get told about new orders the moment
          they happen with webhooks. No app store and no extra fees.
        </p>

        <section className="card p-5 flex flex-col gap-4" aria-labelledby="keys-heading">
          <h2 id="keys-heading" className="font-semibold">API keys</h2>
          {live.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {live.map((k) => (
                <li key={k.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-medium">{k.name}</span>
                  <code className="hint">{k.prefix}…</code>
                  <span className={`pill ${k.access === "write" ? "pill-warning" : "pill-neutral"}`}>{k.access === "write" ? "Read and write" : "Read only"}</span>
                  <span className="hint flex-1">Last used {when(k.lastUsedAt)}</span>
                  <form action={revokeApiKeyAction.bind(null, k.id)}>
                    <button className="hint hover:text-critical" aria-label={`Revoke ${k.name}`}>Revoke</button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No keys yet.</p>
          )}
          <ApiKeyForm />
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">How to use the API</summary>
            <div className="flex flex-col gap-2 pt-3">
              <p>Send the key in the Authorization header. Amounts are in cents. Up to 120 requests a minute per key.</p>
              <pre className="bg-sunken rounded p-3 overflow-x-auto text-xs">{`curl ${base}/orders?payment_status=paid \\
  -H "Authorization: Bearer sfk_..."`}</pre>
              <ul className="list-disc pl-5 hint">
                <li><code>GET /shop</code></li>
                <li><code>GET /orders</code> with <code>payment_status</code>, <code>fulfillment_status</code>, <code>updated_since</code>, <code>limit</code>, <code>page</code></li>
                <li><code>GET /orders/:id</code> and <code>POST /orders/:id/tracking</code> with <code>carrier</code>, <code>tracking_number</code>, <code>tracking_url</code></li>
                <li><code>GET /products</code> with <code>status</code>, <code>limit</code>, <code>page</code></li>
                <li><code>GET /products/:id</code> and <code>PATCH /products/:id</code> with <code>status</code> and <code>variants: [{"{"}id, price, stock{"}"}]</code></li>
              </ul>
            </div>
          </details>
        </section>

        <section className="card p-5 flex flex-col gap-4" aria-labelledby="webhooks-heading">
          <h2 id="webhooks-heading" className="font-semibold">Webhooks</h2>
          {endpoints.map((ep) => (
            <article key={ep.id} className="border border-border rounded-lg p-4 flex flex-col gap-3" aria-label={`Webhook ${ep.url}`}>
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-sm break-all flex-1">{ep.url}</code>
                <span className={`pill ${ep.active ? "pill-success" : "pill-neutral"}`}>{ep.active ? "On" : "Paused"}</span>
              </div>
              <p className="hint text-sm">{ep.events.map((e) => WEBHOOK_EVENT_LABELS[e]).join(", ")}</p>
              <Secret value={ep.secret} />
              <div className="flex flex-wrap gap-3 items-center">
                <TestWebhookButton id={ep.id} />
                <form action={setWebhookActiveAction.bind(null, ep.id, !ep.active)}><button className="hint hover:text-ink">{ep.active ? "Pause" : "Turn back on"}</button></form>
                <form action={deleteWebhookAction.bind(null, ep.id)}><button className="hint hover:text-critical">Remove</button></form>
              </div>
              {ep.deliveries.length > 0 && (
                <table className="w-full text-sm">
                  <caption className="text-left hint pb-1">Recent deliveries</caption>
                  <tbody className="divide-y divide-border">
                    {ep.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="py-1.5"><code>{d.event}</code></td>
                        <td className="py-1.5">
                          {d.status === "delivered" ? (
                            <span className="text-success">Delivered</span>
                          ) : d.status === "failed" ? (
                            <span className="text-critical" title={d.lastError ?? undefined}>Gave up after {d.attempts} tries</span>
                          ) : d.attempts ? (
                            <span className="text-warning" title={d.lastError ?? undefined}>Retrying ({d.attempts} {d.attempts === 1 ? "try" : "tries"})</span>
                          ) : (
                            <span className="hint">Waiting</span>
                          )}
                          {d.lastStatusCode ? <span className="hint num"> · {d.lastStatusCode}</span> : null}
                        </td>
                        <td className="py-1.5 hint">{when(d.deliveredAt ?? d.createdAt)}</td>
                        <td className="py-1.5 text-right">
                          {d.status !== "delivered" && <form action={retryDeliveryAction.bind(null, d.id)}><button className="hint hover:text-ink">Retry now</button></form>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          ))}
          <WebhookForm events={WEBHOOK_EVENTS.map((e) => ({ value: e, label: WEBHOOK_EVENT_LABELS[e] }))} />
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Checking the signature</summary>
            <div className="flex flex-col gap-2 pt-3">
              <p>
                Each request has an <code>X-Storefront-Signature</code> header like <code>t=1700000000,v1=…</code>. Compute an
                HMAC-SHA256 of <code>t + &quot;.&quot; + raw body</code> with your signing secret and compare it to <code>v1</code>.
                Reject requests older than five minutes. Answer with any 2xx status; anything else is retried after 1 minute, 5
                minutes, 30 minutes, 2 hours and 12 hours.
              </p>
              <pre className="bg-sunken rounded p-3 overflow-x-auto text-xs">{`const [t, v1] = header.split(",").map((p) => p.split("=")[1]);
const expected = crypto.createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));`}</pre>
            </div>
          </details>
        </section>
      </div>
    </main>
  );
}
