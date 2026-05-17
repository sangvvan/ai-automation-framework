# Component Library

Reusable UI components live in `app/components/ui/` (PascalCase). Feature
components live in `app/components/{feature}/`. **Every** component
documented here must have:
- All states (default / hover / focus-visible / active / disabled / loading / error / empty)
- A keyboard interaction note
- Token-only styling
- A Vitest component test
- Optional Playwright visual snapshot for design-critical components

> Empty template — Design Agent populates as the design system grows.

---

## Template (copy for new components)

### `<ComponentName>`
**Path:** `app/components/ui/ComponentName.tsx`

**Purpose:** One sentence — what user need does this component serve?

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'primary' \| 'secondary' \| 'ghost'` | `'primary'` | visual variant |
| size    | `'sm' \| 'md' \| 'lg'`              | `'md'`     | tap-target size |
| disabled| `boolean`                           | `false`    | non-interactive |
| isLoading| `boolean`                          | `false`    | shows spinner |

**States**
- default — base
- hover   — `hover:bg-brand-hover` (mouse only)
- focus-visible — 2px ring `focus-visible:ring-2 focus-visible:ring-brand`
- active  — `active:scale-[0.98]`
- disabled — 50 % opacity, `cursor-not-allowed`, `aria-disabled`
- loading — spinner replaces content, `aria-busy="true"`

**A11y**
- Real `<button>` element
- Keyboard: Enter / Space activates
- Min tap target: 44 × 44 px on `size="md"`+

**Tokens used**
- bg: `bg-brand`, `dark:bg-brand`
- text: `text-white`
- focus: `ring-brand`
- radius: `rounded-md`
- spacing: `px-4 py-2`

**Tests**
- `app/components/ui/ComponentName.test.tsx` — render, keyboard activation, disabled state
- (optional) `tests/e2e/components/ComponentName.visual.spec.ts` — snapshot

---

## Components in this project

### `<Button>`
**Path:** `app/components/ui/Button.tsx`

**Purpose:** Trigger actions or navigate — the primary interactive element across the app.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'primary' \| 'ghost' \| 'destructive'` | `'primary'` | visual variant |
| size | `'sm' \| 'md' \| 'lg'` | `'md'` | tap-target size |
| disabled | `boolean` | `false` | non-interactive |
| isLoading | `boolean` | `false` | shows "Saving…" text, `aria-busy` |
| type | `'button' \| 'submit'` | `'button'` | HTML button type |

**States**
- default — `bg-brand text-white` (primary), `text-brand` (ghost)
- hover — `hover:bg-brand-hover` (primary), `hover:bg-surface` (ghost)
- focus-visible — `focus-visible:ring-2 focus-visible:ring-brand`
- active — `active:scale-[0.98]`
- disabled — 50% opacity, `cursor-not-allowed`, `aria-disabled`
- loading — text replaced with loading text, `aria-busy="true"`

**A11y**
- Real `<button>` element
- Keyboard: Enter / Space activates
- Min tap target: 44 × 44 px on `size="md"`+

**Tokens used**
- bg: `bg-brand`, `dark:bg-brand` (primary)
- text: `text-white` (primary), `text-brand` (ghost)
- focus: `ring-brand`
- radius: `rounded-md`
- spacing: `px-4 py-2`

---

### `<Input>`
**Path:** `app/components/ui/Input.tsx`

**Purpose:** Single-line text input for forms.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| type | `'text' \| 'email' \| 'tel' \| 'url' \| 'date' \| 'password'` | `'text'` | HTML input type |
| error | `string \| undefined` | `undefined` | shows error state + message |
| hint | `string \| undefined` | `undefined` | help text below input |

**States**
- default — `border-border bg-bg`
- focus — `focus-visible:ring-2 focus-visible:ring-brand`
- invalid — `border-error`, `aria-invalid="true"`, `aria-describedby` to error
- disabled — 50% opacity

**A11y**
- Must be paired with `<Label htmlFor>`
- `aria-invalid` + `aria-describedby` when error present
- Placeholder is hint, not label

**Tokens used**
- border: `border-border`, `border-error` (invalid)
- bg: `bg-bg dark:bg-bg`
- radius: `rounded-md`
- spacing: `px-3 py-2`

---

### `<Label>`
**Path:** `app/components/ui/Label.tsx`

**Purpose:** Accessible form label associated with an input via `htmlFor`.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| htmlFor | `string` | required | ID of associated input |
| required | `boolean` | `false` | shows required indicator |

**Tokens used**
- text: `text-sm font-medium text-text`

---

### `<Select>`
**Path:** `app/components/ui/Select.tsx`

**Purpose:** Native select dropdown for choosing from a list of options.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| options | `{ value: string; label: string }[]` | required | list of options |
| error | `string \| undefined` | `undefined` | error state |
| placeholder | `string` | `'Select…'` | default option text |

**States**
- default — `border-border bg-bg`
- focus — `focus-visible:ring-2 focus-visible:ring-brand`
- invalid — `border-error`

**A11y**
- Must be paired with `<Label>`
- `aria-invalid` + `aria-describedby` when error

**Tokens used**
- border: `border-border`
- bg: `bg-bg dark:bg-bg`
- radius: `rounded-md`
- spacing: `px-3 py-2`

---

### `<Textarea>`
**Path:** `app/components/ui/Textarea.tsx`

**Purpose:** Multi-line text input for longer content like bios.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| rows | `number` | `4` | visible rows |
| error | `string \| undefined` | `undefined` | error state |
| maxLength | `number \| undefined` | `undefined` | optional character limit |

**States**
- default — `border-border bg-bg`
- focus — `focus-visible:ring-2 focus-visible:ring-brand`
- invalid — `border-error`

**A11y**
- Must be paired with `<Label>`
- Resizable vertically (`resize-y`)

**Tokens used**
- border: `border-border`
- bg: `bg-bg dark:bg-bg`
- radius: `rounded-md`
- spacing: `px-3 py-2`

---

### `<Card>`
**Path:** `app/components/ui/Card.tsx`

**Purpose:** Container for grouping related content with a subtle border and background.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'default' \| 'hoverable'` | `'default'` | hoverable adds hover bg shift |
| as | `'div' \| 'a'` | `'div'` | renders as link when hoverable |

**States**
- default — `bg-surface border-border`
- hover (hoverable) — `hover:bg-surface/80`, 150ms ease

**Tokens used**
- bg: `bg-surface dark:bg-surface`
- border: `border border-border`
- radius: `rounded-md`
- shadow: `shadow-sm`
- spacing: `p-4` or `p-6`

---

### `<Badge>`
**Path:** `app/components/ui/Badge.tsx`

**Purpose:** Inline label for categorization (e.g., level, status).

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'brand' \| 'accent' \| 'success' \| 'warning' \| 'error'` | `'brand'` | color scheme |

**Tokens used**
- bg: `bg-brand` (brand), `bg-accent` (accent), etc.
- text: `text-white`
- radius: `rounded-full`
- spacing: `px-2 py-0.5`
- typography: `text-xs font-medium`

---

### `<Avatar>`
**Path:** `app/components/ui/Avatar.tsx`

**Purpose:** Display a user's profile photo with initials fallback.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| src | `string \| null` | `null` | photo URL |
| name | `string` | required | used for initials fallback + alt text |
| size | `'sm' \| 'md' \| 'lg'` | `'md'` | sm=32, md=40, lg=96 |

**States**
- with photo — `<img>` with `alt="{name}"` (decorative if name text is adjacent: `alt=""`)
- fallback — colored circle with initials, `aria-hidden="true"` if name is adjacent

**Tokens used**
- bg (fallback): `bg-brand`
- text: `text-white`
- radius: `rounded-full`
- sizes: `w-8 h-8` (sm), `w-10 h-10` (md), `w-24 h-24` (lg)

---

### `<FileUpload>`
**Path:** `app/components/ui/FileUpload.tsx`

**Purpose:** File input styled as a button with preview support for image uploads.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| accept | `string` | `'image/jpeg,image/png,image/webp'` | accepted MIME types |
| maxSizeMB | `number` | `5` | max file size in MB |
| error | `string \| undefined` | `undefined` | error message |
| onChange | `(file: File \| null) => void` | required | callback |

**States**
- default — styled button "Upload photo"
- with file — shows file name or preview
- invalid — `border-error`, error message shown
- loading — `aria-busy="true"`

**A11y**
- `aria-label="Upload profile photo"`
- Keyboard: Enter / Space opens file picker
- Error announced via `aria-describedby`

**Tokens used**
- border: `border border-border border-dashed`
- text: `text-brand`
- radius: `rounded-md`
- spacing: `px-4 py-2`

---

### `<Banner>`
**Path:** `app/components/ui/Banner.tsx`

**Purpose:** Page-level or section-level feedback message (success, error, info, warning).

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'success' \| 'error' \| 'info' \| 'warning'` | required | color + icon |
| dismissible | `boolean` | `false` | shows close button |

**States**
- success — `bg-success/10 text-success`, `role="status"`
- error — `bg-error/10 text-error`, `role="alert"`
- info — `bg-info/10 text-info`, `role="status"`
- warning — `bg-warning/10 text-warning`, `role="alert"`

**A11y**
- Uses `role="alert"` (error/warning) or `role="status"` (success/info)
- Dismiss button: `aria-label="Dismiss"`

**Tokens used**
- radius: `rounded-md`
- spacing: `px-4 py-3`

---

### `<Breadcrumb>`
**Path:** `app/components/ui/Breadcrumb.tsx`

**Purpose:** Show page hierarchy for navigation context on detail/form pages.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| items | `{ label: string; href?: string }[]` | required | crumb items; last has no href |

**A11y**
- `<nav aria-label="Breadcrumb">`
- Last item uses `aria-current="page"`, rendered as text not link
- Separator is decorative (`aria-hidden="true"`)

**Tokens used**
- text: `text-sm text-muted` (links), `text-sm text-text font-medium` (current)
- link: `text-brand hover:text-brand-hover`

---

### `<ReadOnlyField>`
**Path:** `app/components/ui/ReadOnlyField.tsx`

**Purpose:** Display a label + value pair without an editable control (for restricted fields).

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | required | field label |
| value | `string` | required | displayed value |

**Tokens used**
- label: `text-sm font-medium text-muted`
- value: `text-base text-text`
- bg: `bg-surface/50`
- spacing: `px-3 py-2`
- radius: `rounded-md`

---

### `<Skeleton>`
**Path:** `app/components/ui/Skeleton.tsx`

**Purpose:** Placeholder loading animation matching the shape of content being loaded.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'line' \| 'circle' \| 'card'` | `'line'` | shape type |
| width | `string` | `'w-full'` | Tailwind width class |
| height | `string` | `'h-4'` | Tailwind height class |

**Tokens used**
- bg: `bg-surface animate-pulse`
- radius: `rounded-md` (line/card), `rounded-full` (circle)

---

### `<EmptyState>`
**Path:** `app/components/ui/EmptyState.tsx`

**Purpose:** Shown when a list or search has no results — includes icon, heading, and optional CTA.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| icon | `ReactNode` | required | illustrative icon |
| heading | `string` | required | main message |
| description | `string \| undefined` | `undefined` | secondary text |
| action | `{ label: string; href: string } \| undefined` | `undefined` | optional CTA button |

**Tokens used**
- text: `text-lg font-semibold text-text` (heading), `text-sm text-muted` (description)
- spacing: `py-12` centered
- icon: `text-muted w-12 h-12`

---

### `<SearchInput>`
**Path:** `app/components/ui/SearchInput.tsx`

**Purpose:** Text input with search icon and built-in debounce for search/filter UIs.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| placeholder | `string` | `'Search…'` | placeholder text |
| debounceMs | `number` | `300` | debounce delay |
| value | `string` | `''` | controlled value |
| onChange | `(value: string) => void` | required | debounced callback |

**States**
- default — search icon left, text input
- focus — `focus-visible:ring-2 focus-visible:ring-brand`
- with value — shows clear button (X)

**A11y**
- `role="searchbox"`, `aria-label` describing search context
- Clear button: `aria-label="Clear search"`

**Tokens used**
- border: `border-border`
- bg: `bg-bg dark:bg-bg`
- icon: `text-muted`
- radius: `rounded-md`
- spacing: `pl-10 pr-4 py-2` (icon offset)

---

### `<ChangeHistoryTable>`
**Path:** `app/components/ui/ChangeHistoryTable.tsx`

**Purpose:** Compact audit log table showing line manager changes for an engineer.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| entries | `{ date: string; previousManager: string; newManager: string; changedBy: string }[]` | required | history rows |

**A11y**
- `<table>` with `<caption>` "Line manager change history"
- `<th scope="col">` for headers
- Empty state: muted text "No changes recorded yet."

**Tokens used**
- header bg: `bg-surface/50`
- border: `border-b border-border`
- text: `text-xs font-semibold text-muted` (headers), `text-sm text-text` (cells)
- spacing: `px-3 py-2`

---

### `<ProficiencyRadioGroup>`
**Path:** `app/components/skills/ProficiencyRadioGroup.tsx`

**Purpose:** Let engineers and managers choose one proficiency level from a fixed 1-5 rubric while seeing each level's label and description.

**Props**
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| name | `string` | required | form field name submitted with the selected level |
| value | `1 \| 2 \| 3 \| 4 \| 5 \| undefined` | `undefined` | selected proficiency level |
| levels | `{ level: 1 \| 2 \| 3 \| 4 \| 5; label: string; description?: string }[]` | required | ordered rubric options |
| error | `string \| undefined` | `undefined` | field error shown under the group |
| disabled | `boolean` | `false` | disables all options |
| required | `boolean` | `false` | marks the group as required |

**States**
- default — five bordered options stacked on mobile, each with level number, label, and optional description
- hover — option surface shifts with `hover:bg-surface/80`
- focus-visible — active radio option uses `focus-visible:ring-2 focus-visible:ring-brand`
- selected — `border-brand bg-brand/5` with selected indicator and `aria-checked="true"`
- active — `active:scale-[0.98]` on the selected option trigger
- disabled — 50% opacity, `cursor-not-allowed`, `aria-disabled`
- error — group border/error text uses `border-error` and `text-error`; error is announced with `role="alert"`
- loading — skeleton option rows when rubric labels are being fetched

**A11y**
- Renders a native radio input per level inside a `<fieldset>` with a visible `<legend>`
- Keyboard: Tab enters the group; Arrow keys move between options; Space selects
- Each option includes `aria-describedby` pointing to its rubric description when present
- Error text uses an ID referenced by `aria-describedby`
- Min tap target: 44 × 44 px for every option

**Tokens used**
- border: `border-border`, `border-brand`, `border-error`
- bg: `bg-bg dark:bg-bg`, `bg-brand/5`
- text: `text-text`, `text-muted`, `text-error`
- focus: `ring-brand`
- radius: `rounded-md`
- spacing: `p-3`, `gap-2`, `space-y-3`

**Tests**
- `app/components/skills/ProficiencyRadioGroup.test.tsx` — render, keyboard selection, error state, disabled state
