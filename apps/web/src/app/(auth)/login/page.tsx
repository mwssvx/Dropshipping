import { AuthForm } from "../AuthForm";
import { signInAction } from "../actions";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">Sign in to your store</h1>
      <AuthForm mode="login" action={signInAction} />
    </div>
  );
}
