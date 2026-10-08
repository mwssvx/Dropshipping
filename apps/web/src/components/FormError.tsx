export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="banner banner-critical">
      {message}
    </p>
  );
}
