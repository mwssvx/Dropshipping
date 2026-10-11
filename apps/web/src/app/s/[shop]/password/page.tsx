import { redirect } from "next/navigation";
import { activeClosure } from "@sf/core";
import { closureDate, loadShop, loadTheme, storeBase, storeLang, storeT } from "../data";
import { passwordSignupAction, storePasswordAction } from "../actions";

export const metadata = { robots: { index: false } };

/** Before launch: what the store is, when it opens, a list to hear about it, and the way in. */
export default async function PasswordPage({ params, searchParams }: { params: Promise<{ shop: string }>; searchParams: Promise<{ wrong?: string; signup?: string }> }) {
  const { shop: param } = await params;
  const { wrong, signup } = await searchParams;
  const [shop, theme, base, t, lang] = await Promise.all([loadShop(param), loadTheme(param), storeBase(param), storeT(param), storeLang(param)]);
  const closure = activeClosure(shop);
  if (closure?.mode !== "password") redirect(base || "/");
  const opens = closureDate(closure.until, lang);
  const logo = theme.settings.logoText || shop.name;
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md flex flex-col gap-8 text-center">
        <div className="flex flex-col gap-3 items-center">
          {theme.settings.logoUrl ? <img src={theme.settings.logoUrl} alt={logo} className="h-12 w-auto" /> : <p className="text-2xl font-bold tracking-tight">{logo}</p>}
          <h1 className="text-3xl font-bold tracking-tight">{t.passwordTitle}</h1>
          {opens && <p className="font-medium">{t.passwordOpensOn(opens)}</p>}
          {closure.message && <p className="text-muted whitespace-pre-line">{closure.message}</p>}
        </div>

        <section className="card p-5 flex flex-col gap-3" aria-labelledby="notify">
          <h2 id="notify" className="font-semibold">{t.passwordNotify}</h2>
          {signup && <p role="status" className={`text-sm font-medium ${signup === "invalid" ? "text-critical" : ""}`}>{signup === "sent" ? t.signupSent : t.signupInvalid}</p>}
          {signup !== "sent" && (
            <form action={passwordSignupAction.bind(null, param)} className="flex gap-2">
              <label htmlFor="notify-email" className="sr-only">{t.signupEmail}</label>
              <input id="notify-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input flex-1 min-w-0" />
              <button className="btn btn-primary">{t.signUp}</button>
            </form>
          )}
        </section>

        <details className="text-sm" open={!!wrong}>
          <summary className="cursor-pointer hint">{t.passwordHaveOne}</summary>
          <form action={storePasswordAction.bind(null, param)} className="mt-3 flex flex-col gap-2 text-left">
            {wrong && <p className="text-critical text-sm font-medium" role="status">{t.passwordWrong}</p>}
            <label htmlFor="store-password" className="label">{t.passwordLabel}</label>
            <div className="flex gap-2">
              <input id="store-password" name="password" type="password" required autoComplete="current-password" className="input flex-1 min-w-0" />
              <button className="btn btn-secondary">{t.passwordEnter}</button>
            </div>
          </form>
        </details>
      </div>
    </main>
  );
}
