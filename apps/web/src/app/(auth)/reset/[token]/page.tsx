import { ResetForm } from "./ResetForm";

export const metadata = { title: "Set a new password", robots: { index: false } };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">Set a new password</h1>
      <ResetForm token={token} />
    </div>
  );
}
