"use client";

export function PrintButton({ children = "Print or save as PDF" }: { children?: React.ReactNode }) {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      {children}
    </button>
  );
}
