---
name: sql-apps-design
description: "Use for substantial SQL Apps layout, component, visual direction or responsive design work after domain scope is agreed."
---

# Design the application

Work in the confirmed absolute application checkout. `sql-apps-application` remains authoritative for data, identity, capabilities and functional acceptance.

Preserve existing workflows and dependencies. Do not assume named files, hooks, tokens, components or packages exist. Do not add a framework, package, font download or shared SQL Apps design system without explicit approval.

## Design for the task

These are applications people work in, not pages people look at. Success is the user finishing a task, so scanability, consistent behavior, honest density and the real usage scene outrank expression. That is not permission to be plain: personality belongs in precise details — the shape of a control, the restraint of a palette, one considered moment of motion — rather than in a louder page.

## Choose a direction

For a substantial screen or redesign, present two or three app-specific visual directions with trade-offs and a recommendation. Agree on one before implementation. For a small refinement, follow the existing visual language.

Name the chosen tone and one signature detail. Use them to guide typography, color, spacing, shape and layout instead of adding decoration without purpose.

Refinement preserves; redesign replaces. A refinement keeps the existing identity, behavior, copy and everything outside its scope. A redesign keeps the product's truth and function but treats the old look as evidence rather than as a starting point. Do not split the difference by polishing a look that was already rejected. Ask before changing factual copy or adding claims.

Product screens show account and access states, never persona selectors. Test identities stay on the local developer page. Visual approval does not authorize schema, data or startup changes.

## Implement with the existing system

Inspect the actual application structure first. Reuse its semantic tokens and components. Keep controls semantic, keyboard-operable and visibly focused. Maintain contrast, readable type, responsive layout and reduced-motion support.

Let the outer layout constrain wide content; charts and dense components should size from their container. Use deliberate empty, loading, error, disabled and success states. Prefer one clear hierarchy over many competing accents.

The agreed direction outranks the generic defaults listed in the craft floor. When it calls for something that list warns against, do it deliberately and say why; arriving there because nothing stopped you is the failure case.

Load detailed guidance only when needed:

- [Craft Floor](references/craft-floor.md) immediately before any UI edit, including small refinements, for the generic defaults to avoid and the checks the built result must pass. Skip it for planning-only work.
- [UI Style Recipes](references/ui-style-recipes.md) for controls, tables, dialogs and repeated components.
- [Visual Style Recipes](references/visual-style-recipes.md) for charts, theming and data colors.
- [Visual Formatting Rules](references/formatting.md) for compatible visualization libraries.

## Review the rendered result

Bound this work. Build the change fully, then inspect once in a single round that covers desktop and narrow-mobile widths together, fix everything that round surfaces in one batch, and confirm with at most one more round. Then stop and report. An open-ended polish loop spends the user's budget on diminishing returns; functional and workflow acceptance belongs to `sql-apps-validation`, not to another screenshot.

When safe and feasible, inspect the real interface at both widths. Exercise reachable loading, empty, error, disabled and success states, plus keyboard focus.

If browser preview or a state is unavailable, state the limit and report what was inspected. Source review, a build or a screenshot alone is not visual acceptance. Label synthetic or mock-only behavior.

Report the approved direction by name — the tone and signature detail — with inspected widths, states, iterations and remaining checks. Naming the direction lets a later session continue it instead of drifting.
