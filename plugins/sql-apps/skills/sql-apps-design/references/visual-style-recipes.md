---
name: visual-style-recipes
description: Use when a SQL Apps screen needs a chart, data visualization, or dense visual summary.
---

# Visual style recipes

First inspect the data shape, the application's current rendering approach, and installed dependencies. Prefer the existing chart or drawing system. Do not add a visualization package merely because a recipe names a chart type.

## Choose the visual from the question

- **Single value:** one important total with a plain label and relevant time or scope.
- **Bar:** compare categories; use a zero baseline and sort when order helps the task.
- **Line:** show change over an ordered interval; disclose gaps rather than connecting missing data silently.
- **Scatter:** show the relationship between two numeric measures.
- **Area:** show cumulative magnitude only when the filled quantity has meaning.
- **Table:** use when exact values, many fields, or row actions matter more than shape.

Do not add a chart when a sentence, value, or small table answers the question faster.

## Data and formatting

- Name the measure, unit, time range, filters, and timezone.
- Use one number and date format per meaning.
- Keep comparable precision consistent.
- Discover real categories before assigning stable colors.
- Never use color as the only distinction; add labels, position, shape, or pattern.
- Hide legends that repeat a single visible series.
- Expose exact values through labels, accessible text, a tooltip, or a companion table.
- Make truncation, sampling, aggregation, and stale data explicit.

## Layout

Size the visual from its actual container and test realistic long labels. Keep titles in the surrounding page structure when that improves semantics and accessibility. Prevent legends, labels, and axes from clipping at desktop and narrow widths.

Use a stable loading footprint so slow data does not move the whole page. Provide useful empty and error states instead of leaving a blank rectangle.

## Review

Check the rendered result with representative, empty, extreme, and missing values. Verify contrast, keyboard access where interactive, text alternatives, narrow-width behavior, and the supported themes. If the current stack cannot make the visual accessible, use a table or summary instead.
