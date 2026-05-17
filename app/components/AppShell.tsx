import { Form, Link, NavLink } from "@remix-run/react";
import type { ReactNode } from "react";
import { Avatar } from "~/components/Avatar";

interface AppShellProps {
  user: { engineerId: number; name: string; email: string; role: string };
  children: ReactNode;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/directory", label: "Directory" },
  { to: "/skills", label: "Skills" },
];

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link to="/dashboard" className="text-sm font-bold text-gray-900 hover:text-blue-600">
                Team Ops Hub
              </Link>
              <div className="hidden sm:flex items-center gap-1">
                {NAV_ITEMS.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                      ${isActive
                        ? "bg-blue-50 text-blue-700"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to={`/directory/${user.engineerId}`}
                className="flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900"
                aria-label="My profile"
              >
                <Avatar name={user.name} size="sm" />
                <span className="hidden sm:block">{user.name}</span>
              </Link>
              <Form method="post" action="/auth/logout">
                <button
                  type="submit"
                  className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                >
                  Sign out
                </button>
              </Form>
            </div>
          </div>
        </div>
      </nav>

      <main>{children}</main>
    </div>
  );
}
