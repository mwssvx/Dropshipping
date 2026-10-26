import { cookies } from "next/headers";
import QRCode from "qrcode";
import { can, listSignIns, pendingTwoStep, twoStepStatus } from "@sf/core";
import { BRAND } from "@/lib/brand";
import { requireShop, SESSION_COOKIE } from "@/lib/server";
import { PageHeader } from "../PageHeader";
import { startTwoStepAction } from "../../account-actions";
import { ConfirmTwoStepForm, RenewCodesForm, TurnOffForm } from "./TwoStepForms";
import { SignIns } from "./SignIns";
import { SummaryForm } from "./SummaryForm";

export const metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovered?: string }> }) {
  const { user, db, shop, role } = await requireShop();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [status, pending, signIns] = await Promise.all([twoStepStatus(db, user.id), pendingTwoStep(db, user.id, BRAND), listSignIns(db, user.id, token)]);
  const now = Date.now();
  const recovered = (await searchParams).recovered === "1";
  const membership = await db.query.shopMembers.findFirst({ where: (m, { and, eq }) => and(eq(m.shopId, shop.id), eq(m.userId, user.id)) });
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

        {can(role, "money") && (
          <section className="card p-5 flex flex-col gap-4" aria-labelledby="summary-heading">
            <div>
              <h2 id="summary-heading" className="font-semibold">Monday summary</h2>
              <p className="hint">One email a week with last week&apos;s sales, orders, best sellers and profit, and anything waiting for you. Stores with a quiet week and nothing waiting don&apos;t send one.</p>
            </div>
            <SummaryForm shopName={shop.name} on={membership?.weeklySummary ?? true} />
          </section>
        )}
        <section className="card p-5 flex flex-col gap-4" aria-labelledby="sign-ins-heading">
          <div className="flex flex-col gap-1">
            <h2 id="sign-ins-heading" className="font-semibold">Where you&apos;re signed in</h2>
            <p className="hint">
              Each browser and phone signed in to your account. Don&apos;t recognise one? Sign it out and change your password. We email you
              when your account is signed in to on a new kind of device.
            </p>
          </div>
          <SignIns
            items={signIns.map((s) => ({
              id: s.id,
              device: s.device,
              current: s.current,
              signedIn: s.signedInAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
              lastActive: ago(now - s.lastSeenAt.getTime()),
            }))}
          />
        </section>
      </div>
    </main>
  );
}

/** "Active now", "Active 12 minutes ago", "Active 3 days ago". */
function ago(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 10) return "Active now";
  if (minutes < 60) return `Active ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "Active 1 hour ago" : `Active ${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Active yesterday" : `Active ${days} days ago`;
}
