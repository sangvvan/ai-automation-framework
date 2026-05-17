# Interaction Patterns

Cross-screen interaction patterns used across the app. Design Agent
references these in screen specs; Implementation Agent uses them as the
default behaviour.

> Empty template — Design Agent populates as patterns are established.

---

## Navigation

### Top nav (default)
- Logo (left), primary links (center / right), auth state (right edge).
- Sticky on scroll with subtle shadow once scrolled past 8 px.
- Mobile (< md): hamburger button reveals a slide-in drawer.
- All links keyboard reachable; current route uses `aria-current="page"`.

### Sidebar (apps with > 5 sections)
- Persistent on lg+; collapsible on md; drawer on < md.
- Section labels are `<h2>`; items are `<a>` or `<button>`.
- Collapsed state uses `aria-label` for icon-only items.

### Breadcrumbs
- Appear on detail pages with depth ≥ 2.
- Last item is the current page (`aria-current="page"`), not a link.
- Use `<nav aria-label="Breadcrumb">`.

---

## Forms

### Inline validation
- Validate on **blur** (not on every keystroke), and on submit.
- On submit failure: focus the first invalid field, show field error below the input, and announce with `role="alert"`.
- Never disable the submit button to gate validation — let the user submit and surface a clear error.
- Show the password requirements **before** the user types, not only on error.

### Submit + redirect
- Successful action redirects with a flash banner (`role="status"`) on the next page.
- Use Remix `<Form method="post">` so the form works without JS.

---

## Loading

- Prefer **skeleton screens** sized to the real layout over spinners.
- Use spinners only for actions < 1 s where layout is already known.
- Never block the entire page with a spinner — use page-region skeletons.

## Empty states
Three required parts: illustration / icon · headline · primary CTA.
Tone is helpful, not apologetic. Example: *"No posts yet — write the first one."*

## Error states
- Inline (within the affected region): banner with retry button.
- Page-level (route ErrorBoundary): friendly headline, technical details collapsed by default, link back to safety.

---

## Modals + sheets

- Trap focus while open; restore focus to the trigger on close.
- Esc closes; backdrop click closes (unless destructive).
- Title is the modal's accessible name (`aria-labelledby`).
- Mobile (< md): sheet slides up from bottom; desktop: centered modal.

---

## Toasts / notifications

- Live region `role="status"` for non-critical, `role="alert"` for errors.
- Auto-dismiss success after 4 s; never auto-dismiss errors.
- Position: top-right on desktop, bottom-center on mobile.
- Stack max 3; collapse older into a "+ N more" item.

---

## Tables

- Native `<table>` with `<caption>`, `<th scope="col|row">`.
- Sortable columns: button inside `<th>`, `aria-sort="ascending|descending|none"`.
- Pagination outside the table; rows-per-page is a select.
- On mobile (< md): convert to stacked cards if columns > 3.

---

## Locale switching (i18n projects only)

- Locale is **always** in the URL: `/posts/en/...`, `/posts/vi/...`.
- Switcher: native `<select>` or button group with `aria-label="Language"`.
- Switching preserves scroll position when possible.
- If a translation doesn't exist, the URL still resolves to the source locale with a banner offering "Translate this page".

---

## Motion

- Default transition: 150 ms ease-out for hover, 200 ms ease-in-out for layout.
- Honour `prefers-reduced-motion`: disable non-essential transitions.
- No infinite, attention-grabbing animations outside loading indicators.
