import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";

export const meta: MetaFunction = () => [
  { title: "AI Automation Framework | Web System Testing Suite" },
  {
    name: "description",
    content:
      "Run AI-assisted web system tests from URLs or YAML cases, capture evidence, review scenarios, and publish structured reports for regression coverage.",
  },
];

export default function Index() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
        <div className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
            AI-assisted system testing
          </p>
          <h1 className="text-4xl font-bold tracking-normal text-slate-950 dark:text-slate-50 sm:text-5xl">
            AI Automation Framework
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-700 dark:text-slate-300">
            Analyze web pages, execute tester-authored cases, generate
            exploratory scenarios, and review evidence-backed results from one
            framework.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/runs"
            className="inline-flex min-h-11 items-center rounded-md bg-indigo-700 px-5 text-sm font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:bg-indigo-500 dark:text-slate-950 dark:hover:bg-indigo-400 dark:focus-visible:ring-indigo-300 dark:focus-visible:ring-offset-slate-950"
          >
            Review runs
          </Link>
          <Link
            to="/auth/login"
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800 dark:focus-visible:ring-indigo-300 dark:focus-visible:ring-offset-slate-950"
          >
            Sign in
          </Link>
        </div>

        <dl className="grid gap-4 border-t border-slate-200 pt-8 dark:border-slate-800 sm:grid-cols-3">
          <div>
            <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Inputs
            </dt>
            <dd className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-50">
              URLs and test cases
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Execution
            </dt>
            <dd className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-50">
              Playwright scenarios
            </dd>
          </div>
          <div>
            <dt className="text-sm font-medium text-slate-500 dark:text-slate-400">
              Output
            </dt>
            <dd className="mt-1 text-base font-semibold text-slate-950 dark:text-slate-50">
              Reports and evidence
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

export function ErrorBoundary() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
      <div role="alert" className="max-w-sm text-center">
        <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">
          Home page unavailable
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Reload the page or sign in to continue reviewing test runs.
        </p>
      </div>
    </main>
  );
}
