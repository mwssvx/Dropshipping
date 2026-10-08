import Link from "next/link";
import { getInvite, ROLES } from "@sf/core";
import { currentUser, db } from "@/lib/server";
import { AcceptInvite } from "./AcceptInvite";

export const metadata = { title: "Join a store", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, user] = await Promise.all([getInvite(await db(), token), currentUser()]);
  if (!invite || invite.status !== "open") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">This invite can&apos;t be used</h1>
        <p className="hint">{invite?.status === "accepted" ? "It was already accepted." : "It has expired or isn't valid."} Ask the store owner to send a new one.</p>
        <Link className="text-accent font-semibold" href="/login">Sign in</Link>
      </div>
    );
  }
  const next = `/invite/${token}`;
  const role = ROLES[invite.role];
  const q = `?next=${encodeURIComponent(next)}&email=${encodeURIComponent(invite.email)}`;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Join {invite.shop.name}</h1>
        <p className="hint mt-1">You&apos;re invited as <span className="font-semibold text-ink">{role.name.toLowerCase()}</span>. {role.summary}</p>
      </div>
      {!user ? (
        <>
          <p className="text-sm">The invite is for <span className="font-semibold">{invite.email}</span>.</p>
          <Link className="btn btn-primary btn-lg" href={`/signup${q}`}>Create an account</Link>
          <Link className="btn btn-secondary" href={`/login${q}`}>I already have an account</Link>
        </>
      ) : user.email.toLowerCase() !== invite.email ? (
        <>
          <p className="banner banner-warning" role="status">
            You&apos;re signed in as {user.email}, but the invite is for {invite.email}. Sign out, then open the link again and sign in with {invite.email}.
          </p>
          <form action="/logout" method="post"><button className="btn btn-secondary w-full">Sign out</button></form>
        </>
      ) : (
        <AcceptInvite token={token} shopName={invite.shop.name} />
      )}
    </div>
  );
}
