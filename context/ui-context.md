# UI Context

## Two visual layers

The product has **two deliberately separate palettes**, and they must not be merged:

| Layer | Where | Palette |
| ----- | ----- | ------- |
| **App / treasury UI** | `/xero` and every future product screen | the tokens documented below |
| **Marketing** | the landing page at `/` only | the Futura tokens from the Lovable design |

The reasoning: a data-dense treasury workspace and a marketing page have different
jobs. The app palette is tuned for reading columns of figures for an hour; the
marketing palette is tuned for a first impression. Forcing one on the other degrades
both.

The marketing tokens are prefixed `--futura-*` in `app/globals.css` and are **scoped
by the `.futura-landing` wrapper class** on `app/page.tsx`. Where a Tailwind key is
shared (`surface`, `rounded-lg`, `rounded-xl`), the wrapper re-points the underlying
CSS variable rather than the Tailwind key, so the app value is unchanged everywhere
outside that wrapper. Nothing in `components/marketing/` may be used in a product
screen, and nothing in the app palette should be used on the landing page.

Marketing components live in `components/marketing/` — separate from
`components/ui/`, which stays reserved for generated shadcn components.

## Theme

Dark only. No light mode. A dark technical finance workspace — deep navy near-black
backgrounds, layered surfaces, restrained accents, and data-dense tables. The reference
is a premium treasury UI (clean, calm, trustworthy), not a consumer app. Financial
figures use a monospaced face so columns align like a statement. Positive cash reads
green, negative/overdraft reads red — colour carries meaning, not decoration.

## Colors

All components use these tokens. No hardcoded hex values anywhere.

| Role             | CSS Variable        | Value      |
| ---------------- | ------------------- | ---------- |
| Page background  | `--bg-base`         | `#0A1424`  |
| Surface          | `--bg-surface`      | `#111E33`  |
| Raised surface   | `--bg-surface-2`    | `#16263F`  |
| Primary text     | `--text-primary`    | `#E8EEF5`  |
| Muted text       | `--text-muted`      | `#8A9BB0`  |
| Primary accent   | `--accent-primary`  | `#4C82F7`  |
| AI accent (TellMe-equiv) | `--accent-ai` | `#8B5CF6` |
| Border           | `--border-default`  | `#24344C`  |
| Error / negative cash | `--state-error` | `#E5484D`  |
| Success / positive cash | `--state-success` | `#30A46C` |

Notes:
- `--accent-primary` is for interactive elements (buttons, links, active nav).
- `--accent-ai` marks AI-driven features (the assistant / smart suggestions); use a
  subtle violet treatment, sparingly.
- Money values: positive in `--text-primary` or `--state-success` where emphasis helps;
  negative always in `--state-error`.

## Marketing palette (landing page only)

Ported from the Lovable design (`futura-cash-flow-vision`), which is Tailwind v4;
these are the v3 equivalents. Scoped to `.futura-landing` — never use on a product screen.

| Role              | CSS Variable                 | Value       | Tailwind key       |
| ----------------- | ---------------------------- | ----------- | ------------------ |
| Page background   | `--futura-navy`              | `#0B1526`   | `navy`             |
| Surface           | *(re-points `--bg-surface-rgb`)* | `#12213B` | `surface`        |
| Raised surface    | `--futura-surface-elevated`  | `#182B4A`   | `surface-elevated` |
| Accent            | `--futura-accent-blue`       | `#4C82F7`   | `accent-blue`      |
| Primary text      | `--futura-text-primary`      | `#F5F7FB`   | `text-primary`     |
| Secondary text    | `--futura-text-secondary`    | `#A0AEC8`   | `text-secondary`   |
| Tertiary text     | `--futura-text-tertiary`     | `#6B7A99`   | `text-tertiary`    |
| Divider           | `--futura-divider`           | `rgb(148 163 184 / 0.12)` | `divider` |

Colours needing opacity modifiers are stored as RGB channel triplets so Tailwind can
apply `<alpha-value>`. Custom utilities `radial-glow`, `glow-blue` and `glow-blue-sm`
are the ported equivalents of the Lovable `@utility` blocks. The marketing layer also
overrides `--radius-lg` (0.75rem) and `--radius-xl` (1rem) within its wrapper; the app
scale is unchanged.

## Typography

| Role        | Font            | Variable      |
| ----------- | --------------- | ------------- |
| UI text     | Geist Sans (or Inter) | `--font-sans` |
| Figures/mono| Geist Mono (or IBM Plex Mono) | `--font-mono` |

All numeric/financial values render in `--font-mono` with tabular figures so columns align.

## Border Radius

| Context           | Class          |
| ----------------- | -------------- |
| Inline / small UI | `rounded-md`   |
| Cards / panels    | `rounded-xl`   |
| Modals / overlays | `rounded-2xl`  |

## Component Library

shadcn/ui on top of Tailwind. Components live in `components/ui/`. Add new components
via the CLI rather than writing from scratch; do not edit generated library internals.

## Layout Patterns

- **App shell:** fixed left sidebar nav (icon + label), top bar with context/date
  controls, main content area. Mirrors a treasury dashboard.
- **Data tables:** dense, sortable, with a right-hand detail/edit panel that slides in
  (e.g. edit a category, inspect a transaction) — not a separate page.
- **Cash flow grid:** the forecast/position view behaves like a spreadsheet — rows are
  categories, columns are weeks/months, cells are editable where manual override is allowed.
- **Modals:** centered overlay with backdrop blur for focused actions.
- **States:** every data view has explicit loading, empty, and error states; never show
  a blank or a half-loaded figure.

## Icons

Lucide React. Stroke-based only. `h-4 w-4` inline, `h-5 w-5` in buttons.
