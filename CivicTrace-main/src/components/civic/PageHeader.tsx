export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Shown on every data screen: this dashboard reads and writes the same Supabase
 * project as the public QR website, so the figures are shared records.
 */
export function DataSourceNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-muted-foreground ${className}`}>
      <span className="font-semibold">
        Live shared records from the CivicTrace Supabase project.
      </span>{" "}
      The same <span className="font-mono">entities</span> and{" "}
      <span className="font-mono">events</span> tables used by the public QR website.
    </p>
  );
}

/**
 * Fields the shared schema does not carry. They are shown as "Not recorded"
 * rather than filled with invented values.
 */
export function SchemaCoverageNote({
  fields,
  className = "",
}: {
  fields: string[];
  className?: string;
}) {
  if (!fields.length) return null;
  return (
    <p className={`text-[11px] text-muted-foreground ${className}`}>
      <span className="font-semibold">Not recorded in the shared database:</span>{" "}
      {fields.join(", ")}. These columns do not exist on the shared tables, so the dashboard shows
      them as “Not recorded” instead of inventing values.
    </p>
  );
}

export function DetectVerifyActNote() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
      <span className="font-semibold text-normal">CivicTrace detects</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold">MCD verifies</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-semibold">Existing MCD processes act</span>
      <span className="ml-auto text-muted-foreground">
        Administrative review signal, not a final determination.
      </span>
    </div>
  );
}
