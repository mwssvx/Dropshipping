import { AuthForm } from "../AuthForm";
import { signUpAction } from "../actions";

export const metadata = { title: "Create your account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const { next, email } = await searchParams;
  const invited = next?.startsWith("/invite/");
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">{invited ? "Create your account to join the team" : "Start selling"}</h1>
        <p className="hint mt-1">{invited ? "Use the email address the invite was sent to." : "Everything you need is included, with no apps to buy. Start free."}</p>
      </div>
      <AuthForm mode="signup" action={signUpAction} next={invited ? next : undefined} email={email} />
    </div>
  );
}
