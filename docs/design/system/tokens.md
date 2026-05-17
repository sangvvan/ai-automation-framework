# Design Tokens

Canonical design tokens for the project. Implementation Agent compiles
these into `tailwind.config.ts` and `app/styles/globals.css`.

> Update brand colours / typography here, then update the corresponding
> CSS variable values. **Never** hardcode raw hex / pixel values in
> components.

## Brand
```
Product : <fill in>
Tone    : <e.g. "clean editorial, content-first">
Stack   : Web — Remix + Tailwind CSS
```

## Colors — semantic, light + dark

### Light mode (default)
```
--color-brand        : 37 99 235      # blue-600
--color-brand-hover  : 29 78 216
--color-accent       : 124 58 237     # violet-600
--color-bg           : 255 255 255
--color-surface      : 248 250 252    # slate-50
--color-text         : 15 23 42       # slate-900
--color-text-muted   : 100 116 139    # slate-500
--color-border       : 226 232 240    # slate-200
--color-ring         : 59 130 246     # blue-500
--color-success      : 22 163 74      # green-600
--color-warning      : 217 119 6      # amber-600
--color-error        : 220 38 38      # red-600
--color-info         : 37 99 235      # blue-600
```

### Dark mode (`html.dark`)
```
--color-bg           : 15 23 42       # slate-900
--color-surface      : 30 41 59       # slate-800
--color-text         : 241 245 249    # slate-100
--color-text-muted   : 148 163 184    # slate-400
--color-border       : 51 65 85       # slate-700
```

## Typography
```
--font-sans  : Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
--font-serif : "Source Serif Pro", Georgia, serif
--font-mono  : "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace
```

| Token | Size | Line height | Use for |
|-------|------|-------------|---------|
| text-xs   | 0.75rem  (12) | 1rem  (16) | meta, captions |
| text-sm   | 0.875rem (14) | 1.25rem (20) | secondary text |
| text-base | 1rem     (16) | 1.5rem  (24) | body |
| text-lg   | 1.125rem (18) | 1.75rem (28) | emphasised body |
| text-xl   | 1.25rem  (20) | 1.75rem (28) | h3 |
| text-2xl  | 1.5rem   (24) | 2rem    (32) | h2 |
| text-3xl  | 1.875rem (30) | 2.25rem (36) | h1 (mobile) |
| text-4xl  | 2.25rem  (36) | 2.5rem  (40) | h1 (md+) |

Weights: 400 regular · 500 medium · 600 semibold · 700 bold

## Spacing — 4px grid
| Token | rem | px |
|-------|-----|----|
| space-1  | 0.25 |  4 |
| space-2  | 0.5  |  8 |
| space-3  | 0.75 | 12 |
| space-4  | 1.0  | 16 |
| space-5  | 1.25 | 20 |
| space-6  | 1.5  | 24 |
| space-8  | 2.0  | 32 |
| space-10 | 2.5  | 40 |
| space-12 | 3.0  | 48 |
| space-16 | 4.0  | 64 |

## Radii
| Token | Value | Use |
|-------|-------|-----|
| sm   | 0.25rem | chips, badges |
| md   | 0.5rem  | buttons, inputs, cards |
| lg   | 0.75rem | modals, sheets |
| xl   | 1rem    | hero cards |
| full | 9999px  | avatars, pills |

## Shadows
| Token | Value |
|-------|-------|
| sm | `0 1px 2px 0 rgb(0 0 0 / 0.05)` |
| md | `0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)` |
| lg | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` |

## Breakpoints (mobile-first, Tailwind defaults)
| Token | Min width |
|-------|-----------|
| sm  |  640px |
| md  |  768px |
| lg  | 1024px |
| xl  | 1280px |
| 2xl | 1536px |

## Rules
- All colours referenced via the `bg-{name}` / `text-{name}` / `border-{name}` Tailwind utility — never as raw hex.
- Every interactive element must include a focus-visible ring using `--color-ring`.
- Every surface that exists in dark mode must include a `dark:` variant in components.
- Adding or removing any token requires an ADR documenting the rationale.
