import { countryName, payoutRoute, STORE_COUNTRIES } from "@sf/core";
import { requireUser } from "@/lib/server";
import { BRAND } from "@/lib/brand";
import { NewStoreForm } from "./NewStoreForm";

export const metadata = { title: "Name your store" };

// The most common first, then every other country by name.
const FIRST = ["US", "GB", "CA"];
const COUNTRIES = [
  ...FIRST.map((code) => ({ code, name: countryName(code), crossBorder: false })),
  ...STORE_COUNTRIES.filter((c) => !FIRST.includes(c))
    .map((code) => ({ code, name: countryName(code), crossBorder: payoutRoute(code) === "cross_border" }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

export default async function NewStorePage() {
  await requireUser();
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <span className="font-bold text-lg tracking-tight">{BRAND}</span>
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h1 className="text-xl font-bold">Name your store</h1>
            <p className="hint mt-1">You can change the name later. Your store gets a free web address straight away.</p>
          </div>
          <NewStoreForm countries={COUNTRIES} />
        </div>
      </div>
    </main>
  );
}
