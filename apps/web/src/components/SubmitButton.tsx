"use client";
import { useFormStatus } from "react-dom";

export function SubmitButton({ children, className = "btn btn-primary", pendingText, disabled = false }: { children: React.ReactNode; className?: string; pendingText?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}
