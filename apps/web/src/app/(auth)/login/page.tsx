import { AuthForm } from "../AuthForm";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  const invited = next?.startsWith("/invite/");
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">{invited ? "Sign in to accept the invite" : "Sign in to your store"}</h1>
      <AuthForm mode="login" action={signInAction} next={invited ? next : undefined} email={email} />
    </div>
  );
}
