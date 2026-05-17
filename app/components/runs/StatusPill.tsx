interface Props {
  status: string;
}

const CLASSES: Record<string, string> = {
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  failed: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  skipped: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  rejected: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200",
  pending_review: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};

export function StatusPill({ status }: Props) {
  const cls = CLASSES[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      aria-label={`status: ${status}`}
      className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}
    >
      {status}
    </span>
  );
}
