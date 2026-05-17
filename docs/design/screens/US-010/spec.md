# Design spec — US-010 Auth (login & register)

## Routes
- `/auth/login`
- `/auth/register`
- `/auth/logout` (action only)

## Layout (both forms)
- Centered card, 400px max width, full-height.
- Logo + product name top.
- Form fields, primary button, secondary text link to the other action.
- Server-side validation errors rendered inline under each field.

## /auth/login fields
- Email (required, email)
- Password (required, min 1 — handler returns same 422 message for
  missing email and wrong password to prevent enumeration)
- Submit: "Sign in"
- Link: "Don't have an account? Register"

## /auth/register fields
- Name (required, 2–80)
- Email (required, email, unique)
- Password (required, ≥10 chars, ≥1 digit)
- Submit: "Create account"
- Link: "Have an account? Sign in"

## States
- Loading: button shows spinner, disabled.
- Server error: red banner above form (`role="alert"`).
- Field errors: red text under field (`aria-describedby`).
- Success: redirect to `/runs?next` or to `next` param if set.

## Tokens
- Inputs: `rounded-lg border border-slate-300 dark:border-slate-700`
- Primary button: `bg-indigo-600 text-white hover:bg-indigo-700`,
  44px tap target.
- Focus: `focus-visible:ring-2 ring-indigo-500`.

## Accessibility
- Labels visible (not placeholder-only).
- Auto-complete attrs: `email`, `current-password`, `new-password`, `name`.
- Form has a single h1 title per page.

## Security
- CSRF token in hidden field (server-side enforced).
- Bcrypt hash cost ≥10.
- Cookie: HttpOnly, Secure (in prod), SameSite=Lax, signed.
