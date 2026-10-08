import { ForgotForm } from "./ForgotForm";

export const metadata = { title: "Reset your password" };

export default function ForgotPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">Reset your password</h1>
      <ForgotForm />
    </div>
  );
}
