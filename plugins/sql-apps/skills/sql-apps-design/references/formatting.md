---
name: visual-formatting
description: Use when choosing number, date, label, legend, and color formatting for a SQL Apps visualization.
---

# Visual formatting

Use the application's existing locale and formatting helpers. If none exist, use platform-native internationalization APIs rather than hand-built separators or currency symbols.

## Numbers and dates

- Counts use grouped whole numbers unless fractions are meaningful.
- Money includes currency and uses the precision required by the domain.
- Percentages state whether the underlying value is a fraction or already a percentage.
- Dates and times use one format per purpose and state the timezone.
- Comparable values use consistent precision; do not imply accuracy the data does not have.
- Put a shared unit in the heading or axis rather than repeating it in every row.

## Labels and legends

- Use plain-language titles that name the measure and comparison.
- Hide a legend for one obvious series.
- Keep category names stable between the interface and the visual.
- Shorten labels only when the full value remains available.
- Prefer direct labels when they reduce lookup between marks and a legend.

## Color

- Discover the actual categories before defining a stable category-to-color map.
- Use the application's existing palette when it meets contrast needs.
- Pair color with text, shape, or position for status and selection.
- Reserve strong accent colors for the most important comparison or state.
- Recheck contrast in every supported theme and interaction state.

## Renderer-specific rules

Inspect the renderer's documentation and the application's existing examples when exact syntax matters. Keep renderer configuration near the implementation or in a renderer-specific reference; do not turn a general SQL Apps skill into an API manual for a package the application may not use.
