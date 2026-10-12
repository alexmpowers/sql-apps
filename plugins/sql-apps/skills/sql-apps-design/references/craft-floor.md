---
name: craft-floor
description: Use immediately before any UI edit, including small refinements. Names the generic defaults to avoid and the checks that must hold on the built result.
---

# Craft Floor

Load this before editing UI, not while planning. It holds the quality floor and the defaults worth
refusing. It does not choose the direction — the agreed direction does, and it outranks everything
here. When the direction genuinely calls for something on the refuse list, say so and do it
deliberately; drifting into one of these because nothing stopped you is the failure case.

## Defaults worth refusing

These are the category's reflexes, not bans. Each one is what gets produced when no decision was made.

**Page structure**

- Rows of identical cards — icon, heading, two lines of text — used as the structure of the page. Cards
  are a legitimate container (see [UI Style Recipes](ui-style-recipes.md)); cards as the only idea on
  the page are not. Avoid nested cards when spacing or a heading expresses the grouping.
- The hero-metric template — big number, small label, supporting stats, accent color — repeated as the
  page rather than used once where the number deserves it.
- A kicker or eyebrow label above a heading. The heading carries its own weight.
- Section numbers (01 / 02 / 03) when the sequence carries no information.
- A modal for a task that needs neither interruption nor protected focus.

**Surface habits**

- Gradient text, and the purple-to-blue gradient in particular. Emphasis comes from weight, size or
  placement.
- Gray secondary text on a colored or tinted surface. Tint the secondary text from that surface's own
  hue instead.
- Pure `#000`, pure `#fff` and untinted neutral grays. Carry a trace of the palette through them.
- Glass and blur used as decoration rather than as a specific effect with a reason.
- A thick colored `border-left` used to classify cards, rows, callouts or alerts.
- Emoji or Unicode glyphs standing in for an icon system, or icons mixed across families, strokes and
  weights. Pick one family and keep its stroke and optical size consistent.
- Monospace as a costume for "technical". Monospace is for code, identifiers, data and measurement.
- Decorative sparklines, progress rings and placeholder shapes standing in for content that exists.
- Bounce or elastic easing, and an identical entrance animation applied to every section.

## Checks on the built result

Each of these is a check on what rendered, not on what was intended. Run them together in one
inspection round rather than as separate trips.

- **Contrast.** Body and placeholder text at least 4.5:1, large text at least 3:1, verified in every
  theme the app ships and in the hover, disabled and selected states.
- **Spacing.** Read the computed values rather than trusting the class names. Related items tight,
  distinct groups generously separated, more space above a heading than below it.
- **Type.** Body measure roughly 65–75 characters. An obvious step in size or weight between levels —
  if two levels need to be compared to tell them apart, there is one level. Run the longest realistic
  value, not lorem text, at every width.
- **Depth.** Shadows carry an offset and a soft blur. A zero-offset colored halo is decoration, not
  elevation.
- **Motion.** One authored moment rather than many small effects, interruptible, and honoring
  `prefers-reduced-motion`.
- **States.** Hover, focus, active, disabled, loading, empty, error and success — reachable and
  actually exercised, not merely written.
- **Copy.** Controls name the action they perform. Errors name the problem and the recovery.

## Surfaces nobody draws

These ship with browser defaults that belong to no design system, and they are the cheapest signal
that a screen was built rather than assembled:

- Text selection colors and the text caret.
- Scrollbars on every scrollable container, not just the page.
- The focus ring — visible on dark and light surfaces alike, and never removed without a replacement.
- Underline offset and thickness on inline links.
- **Tabular numerals wherever numbers are stacked for comparison** — table columns, metric lists,
  totals. Proportional figures make a column of numbers ragged and unreadable.

## Data application craft

A SQL application is judged on how it presents data under real conditions, not on how the empty shell
looks.

- Numeric columns align right with consistent precision down the column. Put the unit or currency in
  the header, not in every cell.
- Null, empty string and zero must be distinguishable. Rendering all three as a blank cell destroys
  information the query went to the trouble of returning.
- Long identifiers — schema, table, column and object names — truncate with the distinguishing end
  still visible, and the full value reachable by tooltip, selection or detail view.
- Timestamps state their timezone and use one format throughout the app. Relative times ("3 min ago")
  need the absolute value available.
- A raw SQL or driver error is never the user-facing message. Say what failed and what to do next, and
  keep the underlying detail reachable for someone who wants it.
- Result sets state their shape: the row count, truncation made visible rather than silent, and a
  loading state that holds steady through a slow query instead of flashing.
- Dense, repeated elements — badges, chips, status pills, icons in table rows — carry less visual
  weight than the same element in a card. If it competes with the data, reduce it.
