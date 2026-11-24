# DESIGN.md

Design rules for the Pages interface. Coding rules stay in
[`GUIDELINES.md`](GUIDELINES.md); colors, radii and shadows are theme tokens in
`app/styles/tailwind.css`.

## 1. Corner Radii

### Theme radii

Use the theme radii through their Tailwind utilities. Do not add a literal
radius when a theme step fits.

| Utility        | Token          | Value           | Typical role                                     |
| -------------- | -------------- | --------------- | ------------------------------------------------ |
| `rounded-sm`   | `--radius-sm`  | 0.375rem (6 px) | Text links, color marks and highlights in a row  |
| `rounded-md`   | `--radius-md`  | 0.5rem (8 px)   | Checkboxes, small code and log blocks            |
| `rounded-lg`   | `--radius-lg`  | 0.75rem (12 px) | Buttons, small fields, menu items, tooltips      |
| `rounded-xl`   | `--radius-xl`  | 1rem (16 px)    | Fields, selects, menus, popovers, bordered lists |
| `rounded-2xl`  | `--radius-2xl` | 1.25rem (20 px) | Dialogs, content cards, tables on the page       |
| `rounded-3xl`  | `--radius-3xl` | 1.5rem (24 px)  | Large stage surfaces: Kanban columns, auth card  |
| `rounded-full` | –              | 9999px          | Avatars, pills and the scrollbar thumb           |

### Inner radii

A surface inside a rounded surface takes a smaller radius, so both curves stay
parallel:

- The inner radius is the outer radius minus the inset between both edges,
  rounded to the nearest theme step and never larger than the outer radius.
- With a small inset of 4 px (`p-1`), the inner surface is one step smaller:
  a menu or segmented control with `rounded-xl` holds items with `rounded-lg`.
- With a large inset, as the 24 px padding (`p-6`) of a dialog with
  `rounded-2xl`, the content keeps the radius of its own role: fields
  `rounded-xl` or `rounded-lg`, buttons `rounded-lg`.
- A nested surface never repeats or exceeds the radius of the surface around it.

## 2. Rounded Scroll Surfaces

Every surface with a radius that can scroll is a shell around a scrolling
viewport. Use the shell of `ScrollViewport`
(`app/components/ui/scroll-viewport.tsx`) with `isShell`; `VerticalScrollArea`
and `HorizontalScrollArea` pass `isShell` on to it.

- **The shell** (`containerClassName`, or `className` of the scroll-area
  wrappers) carries radius, fill, border or ring, and shadow. It clips the
  viewport.
- **The viewport** (`className`, or `viewportClassName` of the wrappers)
  carries padding, layout and overflow only: no radius, fill, border, ring or
  shadow.
- **The scrollbar stays inside the rounding.** A native scrollbar column paints
  square over the radius of the scrolling element itself, so a radius on the
  viewport shows round corners on one side and square corners where the
  scrollbar runs. The clipping shell keeps all four corners round.
- **Edge fades** inside a shell with a fill use `fadeMode="mask"`, so the
  content fades into the shell's fill instead of a fade painted in the page
  color.
- **Focus** of a focusable viewport stays visible: the shell clips, so the
  viewport draws its outline inside its own edge.

`DialogContent` (`app/components/ui/dialog.tsx`) follows this rule for every
dialog: size, radius, fill, ring and shadow classes of its `className` go to the
shell, all other classes to the scrolling viewport.

```tsx
<ScrollViewport
  axis="horizontal"
  isShell
  containerClassName="rounded-2xl bg-surface shadow-card"
  className="overflow-x-auto"
>
  <table>…</table>
</ScrollViewport>
```

Avoid:

```tsx
<ScrollViewport
  axis="horizontal"
  className="overflow-x-auto rounded-2xl bg-surface shadow-card"
>
  <table>…</table>
</ScrollViewport>
```
