import Link from "next/link";
import { notFound } from "next/navigation";
import { isLanguage, LANGUAGES, shopLanguages, translationList } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { TranslateButton } from "../LanguageForms";

const KIND_NAMES = { theme: "Store", page: "Page", collection: "Collection", product: "Product" } as const;
const STATUS = {
  done: { label: "Translated", pill: "pill-success" },
  outdated: { label: "Out of date", pill: "pill-warning" },
  missing: { label: "Not translated", pill: "pill-neutral" },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return { title: isLanguage(lang) ? LANGUAGES[lang].english : "Language" };
}

export default async function LanguagePage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { lang } = await params;
  const { saved } = await searchParams;
  const { shop, db } = await requireShop("theme");
  if (!isLanguage(lang) || !shopLanguages(shop).includes(lang)) notFound();
  const items = await translationList(db, shop, lang);
  const name = LANGUAGES[lang].english;
  const left = items.filter((i) => i.status !== "done").length;
  return (
    <main className="pb-12">
      <PageHeader title={name} back={<Link href="/admin/languages" className="hint hover:text-ink">← Languages</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-4xl">
        {saved && <p className="banner banner-success" role="status">Translation saved. Buyers reading {name} see it now.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="hint">
            {items.length - left} of {items.length} translated. Out of date means the English changed after it was translated.
          </p>
          <TranslateButton language={lang} complete={left === 0} label="Translate the rest with AI" />
        </div>
        <ul className="card divide-y divide-border">
          {items.map((i) => (
            <li key={`${i.kind}-${i.refId}`} className="flex items-center gap-3 px-4 py-3">
              <span className="hint text-sm w-24 shrink-0">{KIND_NAMES[i.kind]}</span>
              <Link href={`/admin/languages/${lang}/${i.kind}/${i.refId}`} className="flex-1 min-w-0 truncate font-medium hover:underline">{i.label}</Link>
              {i.byAi && i.status !== "missing" && <span className="hint text-xs">AI</span>}
              <span className={`pill ${STATUS[i.status].pill}`}>{STATUS[i.status].label}</span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
