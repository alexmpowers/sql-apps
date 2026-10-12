---
name: ui-style-recipes
description: Use when editing controls, forms, tables, dialogs, navigation, or repeated interface elements in a SQL Apps screen.
---

# UI style recipes

Inspect the application's HTML, CSS, components, and dependencies before choosing an implementation. Reuse what exists. Do not assume a framework, utility library, token file, component package, import alias, or dark-mode mechanism.

## Controls and forms

- Use native semantics first: labels for inputs, buttons for actions, links for navigation, and fieldsets for related choices.
- Keep related controls consistent in height, type, spacing, and corner treatment.
- Provide visible focus, hover, active, disabled, loading, invalid, and error states where they apply.
- Keep the primary action clear. Destructive actions need distinct wording and treatment.
- Put validation near the affected field and preserve entered values after a failed save.
- Use dialogs only when interruption or protected focus is useful. Otherwise keep the action in the page flow.

## Tables and repeated data

- Align text left and comparable numbers right. Put units or currency in the heading when every value shares them.
- Distinguish null, empty text, and zero.
- Keep repeated badges, icons, and actions quieter than the main data.
- Make truncation visible and keep the full value reachable.
- State loading, empty, error, row-count, and result-truncation conditions.
- On narrow screens, preserve task-critical fields and actions rather than shrinking every column.

## Layout and hierarchy

- Give the page one clear primary region and action.
- Group content by task, not by a reflexive grid of identical cards.
- Use spacing, type, and alignment before adding borders or decoration.
- Let containers size wide or dense content. Avoid fixed dimensions that clip realistic values.
- Keep account and access status in product UI; keep simulated identities on the developer page.

## Accessibility check

Use the existing browser and project tools to verify:

- keyboard order and visible focus;
- labels, names, and error associations;
- readable contrast in every supported theme and state;
- zoom and narrow-width behavior;
- reduced motion when animation is present;
- clear recovery from loading and failure states.

Follow the agreed visual direction. These are decision prompts, not a request to replace the application's styling system.
