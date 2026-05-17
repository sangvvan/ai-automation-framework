import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "@remix-run/react"
import "~/styles/globals.css"

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="h-full">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Error</title>
      </head>
      <body className="min-h-screen flex items-center justify-center">
        <div className="text-center" role="alert">
          <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
          <a href="/" className="text-blue-600 hover:underline text-sm">Return home</a>
        </div>
      </body>
    </html>
  )
}
