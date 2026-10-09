import Link from "next/link";
import { LANGUAGE_CODES, LANGUAGES, translationSummary } from "@sf/core";
import { requireShop, storeUrl } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { LanguagesForm, TranslateButton } from "./LanguageForms";

export const metadata = { title: "Languages" };

export default async function LanguagesPage() {
  const { shop, db } = await requireShop("theme");
  const summary = await translationSummary(db, shop);
  return (
    <main className="pb-12">
      <PageHeader title="Languages" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">
          Show your store in the languages of the countries you sell to. Each language gets its own address, like{" "}
          <span className="num">{storeUrl(shop.handle).replace(/^https?:\/\//, "")}/de</span>, that search engines list. Buttons, the cart and
          checkout are translated for you. Your own words (products, collections, pages, menus and home page) are translated by the AI
          translator or by you, and anything not yet translated shows in English.
        </p>
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="langs-heading">
          <h2 id="langs-heading" className="font-semibold">Languages buyers can pick</h2>
          <LanguagesForm options={LANGUAGE_CODES.map((c) => ({ code: c, ...LANGUAGES[c] }))} enabled={shop.languages} />
        </section>
        {summary.map((s) => {
          const name = LANGUAGES[s.language].english;
          const pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
          return (
            <section key={s.language} className="card p-5 flex flex-col gap-3" aria-labelledby={`lang-${s.language}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 id={`lang-${s.language}`} className="font-semibold">{name}</h2>
                <Link href={`/admin/languages/${s.language}`} className="text-sm font-medium text-accent hover:underline">Read and edit</Link>
              </div>
              <div className="h-2 rounded-full bg-sunken overflow-hidden" role="progressbar" aria-label={`${name} translated`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-sm">
                {s.done} of {s.total} translated
                {s.outdated > 0 && <span className="text-warning"> · {s.outdated} out of date</span>}
                {s.missing > 0 && <span className="hint"> · {s.missing} not started</span>}
              </p>
              <TranslateButton language={s.language} complete={s.done >= s.total} label={s.done ? "Translate the rest with AI" : `Translate into ${name} with AI`} />
            </section>
          );
        })}
      </div>
    </main>
  );
}
