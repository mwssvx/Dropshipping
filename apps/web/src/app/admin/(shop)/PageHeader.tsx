export function PageHeader({ title, back, actions }: { title: string; back?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 flex-wrap px-4 sm:px-8 pt-6 pb-4">
      <div className="flex flex-col gap-1 min-w-0">
        {back}
        <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </header>
  );
}
