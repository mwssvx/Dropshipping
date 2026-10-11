import QRCode from "qrcode";
import { pendingTwoStep, twoStepStatus } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { startTwoStepAction } from "../../account-actions";
import { ConfirmTwoStepForm, RenewCodesForm, TurnOffForm } from "./TwoStepForms";

export const metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovered?: string }> }) {
  const { user, db } = await requireShop();
  const [status, pending] = await Promise.all([twoStepStatus(db, user.id), pendingTwoStep(db, user.id, BRAND)]);
  const recovered = (await searchParams).recovered === "1";
  const qr = pending ? await QRCode.toString(pending.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;
  const since = status.since?.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

  return (
    <main className="pb-12">
      <PageHeader title="Your account" />
      <div className="px-4 sm:px-8 flex flex-col gap-6 max-w-3xl">
        <p className="hint">Signed in as {user.email}. These settings are yours, on every store you work on.</p>
        {recovered && status.on && (
          <p className="banner banner-warning" role="status">
            You signed in with a recovery code. If you have a new phone, turn two-step sign-in off and on again to set it up there. Either way,
            make new recovery codes so you have a full set.
          </p>
        )}
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="two-step-heading">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="two-step-heading" className="font-semibold">Two-step sign-in</h2>
              <span className={`pill ${status.on ? "pill-success" : "pill-warning"}`}>{status.on ? "On" : "Off"}</span>
            </div>
            <p className="hint">
              Signing in takes your password and a code from an app on your phone, like Google Authenticator, 1Password or Authy. Someone who
              learns your password still can&apos;t get into your stores, your money or your payouts.
            </p>
          </div>

          {status.on ? (
            <>
              <p className="text-sm">
                On since {since}.{" "}
                <span className={status.recoveryCodesLeft <= 3 ? "text-critical font-medium" : ""}>
                  {status.recoveryCodesLeft === 1 ? "1 recovery code left." : `${status.recoveryCodesLeft} recovery codes left.`}
                </span>
              </p>
              <RenewCodesForm />
              <TurnOffForm />
            </>
          ) : pending ? (
            <ol className="flex flex-col gap-4 text-sm list-decimal pl-5">
              <li className="flex flex-col gap-2">
                <span>Scan this with your authenticator app.</span>
                <div className="w-44 h-44 bg-white p-1 rounded" role="img" aria-label="QR code to add this account to an authenticator app" dangerouslySetInnerHTML={{ __html: qr! }} />
                <span className="hint">
                  Can&apos;t scan it? Enter this key instead:{" "}
                  <code className="font-mono text-ink break-all" aria-label="Setup key">{pending.secret.match(/.{1,4}/g)!.join(" ")}</code>.{" "}
                  On this phone? <a className="underline" href={pending.uri}>Add it to your app</a>.
                </span>
              </li>
              <li className="flex flex-col gap-2">
                <span>Type the 6-digit code the app shows.</span>
                <ConfirmTwoStepForm />
              </li>
            </ol>
          ) : (
            <form action={startTwoStepAction}>
              <button className="btn btn-primary">Set up two-step sign-in</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
