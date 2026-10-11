import { activeClosure } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { ClosureForm } from "./ClosureForm";

export const metadata = { title: "Store status" };

export default async function StoreStatusPage() {
  const { shop } = await requireShop("theme");
  const closure = activeClosure(shop);
  const address = await storeAddress(shop);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="pb-12">
      <PageHeader title="Store status" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint max-w-2xl">
          Keep your store private while you get it ready, or take a break without taking it down. Your products, links and search rankings stay where they are.
        </p>
        {closure?.mode === "password" && (
          <p className="banner banner-info text-sm">
            Visitors see your <a className="underline" href={`${address.replace(/\/$/, "")}/password`} target="_blank">Opening soon page</a>. Anyone who leaves their email there joins your email list, so you can tell them when you launch.
          </p>
        )}
        <section className="card p-5">
          <ClosureForm
            mode={closure?.mode ?? "open"}
            message={closure?.message ?? ""}
            until={closure?.until ?? ""}
            hasPassword={closure?.mode === "password"}
            today={today}
          />
        </section>
      </div>
    </main>
  );
}
