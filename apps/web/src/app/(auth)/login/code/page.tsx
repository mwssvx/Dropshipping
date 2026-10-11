import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { TWO_STEP_COOKIE } from "@/lib/server";
import { CodeForm } from "./CodeForm";

export const metadata = { title: "Enter your code", robots: { index: false } };

export default async function CodePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (!(await cookies()).get(TWO_STEP_COOKIE)) redirect("/login");
  const { next } = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">Enter your code</h1>
        <p className="hint">Open your authenticator app and type the 6-digit code it shows for this account.</p>
      </div>
      <CodeForm next={next?.startsWith("/invite/") ? next : undefined} />
    </div>
  );
}
