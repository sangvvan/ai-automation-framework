import type { MetaFunction } from "@remix-run/node"

export const meta: MetaFunction = () => [
  { title: "My App" },
  { name: "description", content: "Built with the Web SDLC Template" },
]

export default function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">My App</h1>
      <p className="text-center max-w-md text-gray-600">
        Your application starts here. Run{" "}
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">/ps</code>{" "}
        in Claude Code to begin the SDLC pipeline.
      </p>
    </main>
  )
}
