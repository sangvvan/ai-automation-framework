import { StatusPill } from "./StatusPill";

export interface SuiteSummary {
  id: string;
  name: string;
  featureSlug: string;
  regressionTag: string | null;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export function SuiteCard({ suite }: { suite: SuiteSummary }) {
  return (
    <article className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-4">
      <div className="flex-1">
        <h2 className="font-medium">
          {suite.name}{" "}
          <span className="text-slate-400 text-xs">({suite.featureSlug})</span>
        </h2>
        {suite.regressionTag ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
            tag: {suite.regressionTag}
          </p>
        ) : null}
      </div>
      <div className="text-sm">
        <StatusPill status="passed" /> {suite.passed} ·{" "}
        <StatusPill status="failed" /> {suite.failed} ·{" "}
        <StatusPill status="skipped" /> {suite.skipped} · {suite.total} total
      </div>
    </article>
  );
}
