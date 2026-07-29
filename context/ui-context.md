# UI Context

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
