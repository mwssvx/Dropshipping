import { AuthForm } from "../AuthForm";
import { signUpAction } from "../actions";

export const metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold">Start selling</h1>
        <p className="hint mt-1">Everything you need is included. No apps to buy, no fee per sale.</p>
      </div>
      <AuthForm mode="signup" action={signUpAction} />
    </div>
  );
}
