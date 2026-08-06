# @digitalfrontier/theme

Canonical Digital Frontier app theme. Dark-only monochrome — warm near-black
surfaces, cream/beige as the single accent.

## Why this exists

Four apps each carried their own `:root` block. They drifted into **two**
palettes that disagreed on background, card, text, accent and radius — the same
intent expressed in two colour spaces and four sets of numbers:

| token | tron / sentinel | website / flynn |
|---|---|---|
| background | `#0d0d0d` | `#070707` |
| card | `#1c1c1c` | `#0d0d0d` |
| foreground | `#f4f1ec` | `#f6f1e9` |
| primary | `#eae3d6` | `#efe7d9` |
| radius | `0.5rem` | `0.75rem` |

Nobody chose that. Each app applied "the DF theme" by re-deriving it from
whatever it could see, and small differences compounded. Import this instead of
re-deriving.

**tron and sentinel are the reference.** They were already deliberately aligned
— tron's own comments describe its sidebar as *"at parity with Sentinel"*. This
package reproduces them exactly: verified 38/38 tokens identical to tron, and
33/34 exact against sentinel with the one remainder inside 2/255 rounding.

## Install

```bash
npm i github:Digital-Frontier-LDA/df-theme#<sha>
```

Pin the SHA, per the fleet's action-pinning convention.

## Use

```css
/* app/globals.css */
@import "tailwindcss";
@import "@digitalfrontier/theme";
```

Then **delete the app's own `:root` colour block.** CSS custom properties are
last-declaration-wins, so anything the app still declares silently overrides the
package — the app looks themed to whoever wrote it and is off-palette to
everyone else. That is exactly how the drift above happened.

## Verify

```bash
npx df-theme-check
```

Fails if the app redefines a token the package owns, or imports nothing at all.
It checks the *property* — that no local declaration shadows a canonical token —
rather than the presence of an `@import`, which proves nothing on its own.

Wire it into CI so the next application can't quietly pick different colours:

```yaml
- run: npx df-theme-check
```

## Structure

Three layers. Only the first contains literal colours.

1. **Primitives** — `--df-bg`, `--df-text`, `--df-beige`, … the actual values.
2. **Aliases** — `--background`, `--primary`, `--card`, … each a `var()` onto a
   primitive. These are the names shadcn/ui and cva components already expect,
   so existing components keep working untouched.
3. **`@theme inline`** — maps aliases to Tailwind v4 utilities (`bg-background`,
   `text-muted-foreground`, `border-border`, …).

### Reskinning

Override a **primitive**, never an alias:

```css
:root {
  --df-beige: oklch(0.9 0.05 210);   /* every accent follows */
}
```

Overriding `--primary` directly breaks the chain — the alias stops tracking the
primitive, and you've started a fifth palette.

## Tokens

| group | tokens |
|---|---|
| surfaces | `--df-bg` `--df-surface` `--df-surface-2` `--df-rail` |
| ink | `--df-text` `--df-muted` `--df-rail-text` |
| accent | `--df-beige` `--df-beige-muted` `--df-on-beige` |
| lines | `--df-hairline` `--df-line-strong` |
| status | `--df-good` `--df-bad` `--df-warn` `--df-info` (aliased as `--success` `--warning` `--info`) |
| charts | `--df-chart-1` … `--df-chart-5` |
| geometry | `--radius` (+ `sm`/`md`/`lg`/`xl`) |

### Deliberate choices

- **oklch everywhere.** Perceptually uniform, so the chart ramp is even *to the
  eye*, and alpha variants of the accent stay on-hue. Mixing hex and oklch across
  apps is a large part of why two identical palettes read as different ones.
- **Borders are translucent accent, not opaque grey.** They pick up the brand hue
  and let the surface through, so borders recede instead of boxing everything.
- **The sidebar rail is *lighter* than the page, not darker.** It reads as a
  surface above the page rather than a well cut into it.
- **Radius scale is additive** (`calc(var(--radius) - 4px)`), matching the shadcn
  convention its components assume. tron used a multiplicative scale, which
  diverges from what shadcn primitives expect at non-default radii.
- **Status colours are included** because Flynn had already invented its own
  `--good`/`--bad`/`--warn` locally. Standardised so the next app doesn't invent
  a third set.

## Scope

CSS tokens only — no React components. The apps do not share a component layer
today (Website and Sentinel use shadcn/radix; tron and Flynn have no radix at
all), so shipping components would force a migration rather than a drop-in.
