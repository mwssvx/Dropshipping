import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslation, isLanguage, LANGUAGES, NotFoundError } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../../../PageHeader";
import { TranslationForm } from "../../../LanguageForms";

export const metadata = { title: "Translation" };

const FIELD_NAMES: Record<string, string> = { title: "Title", description: "Description", body: "Text", details: "Details (one per line, label: value)" };

export default async function TranslationPage({ params }: { params: Promise<{ lang: string; kind: string; ref: string }> }) {
  const { lang, kind, ref } = await params;
  const { shop, db } = await requireShop("theme");
  if (!isLanguage(lang) || !/^[0-9a-f-]{36}$/i.test(ref)) notFound();
  const item = await getTranslation(db, shop, lang, kind, ref).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const name = LANGUAGES[lang].english;
  const rows = Object.entries(item.source).map(([key, original]) => ({
    key,
    label: item.kind === "theme" ? "Text" : (FIELD_NAMES[key] ?? key),
    original,
    value: item.fields[key] ?? "",
  }));
  return (
    <main className="pb-12">
      <PageHeader title={`${item.label} in ${name}`} back={<Link href={`/admin/languages/${lang}`} className="hint hover:text-ink">← {name}</Link>} />
      <div className="px-4 sm:px-8 flex flex-col gap-4 max-w-5xl">
        {item.status === "outdated" && (
          <p className="banner banner-warning">
            {item.kind === "theme" ? "Some of this text is new since the last translation. Fill in the empty boxes, then save." : "The English changed after this was translated. Check it still says the same thing, then save."}
          </p>
        )}
        {item.kind === "theme" && <p className="hint">Menus, the announcement bar and the text of your home page sections.</p>}
        <section className="card p-5">
          <TranslationForm language={lang} kind={item.kind} refId={ref} rows={rows} />
        </section>
      </div>
    </main>
  );
}
