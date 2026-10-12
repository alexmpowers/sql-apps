---
name: sql-apps-cloud-preview
description: "Use only when the user asks to share SQL Apps, review Azure costs or prerequisites, prepare a what-if, or deploy through the project's existing Azure orchestration."
---

# Prepare SQL Apps for Azure

Sharing is optional. Resolve `../../scripts/sql-apps.mjs` from this installed skill, run `home`, then confirm the requested application checkout with `workspace-check`. Historical local evidence is not deployment consent or cloud readiness.

Load only the material needed for the request:

- For a cost review, read `docs/guides/costs.md` and the selected profile's cost reference.
- For sharing options or prerequisites, read `docs/guides/sharing.md`.
- For deployment, read `docs/reference/deployment.md` and the relevant part of `docs/maintainers/operations.md`.

Use the existing Azure CLI and Bicep orchestration; do not invent commands or another deployment system.

## Select the exact profile

Keep cloud preparation tied to the agreed application:

- Anonymous public demo: synthetic data only; guided deployment remains incomplete.
- Authenticated full foundation: Functions, storage, Key Vault and private networking remain included.
- `role-based-data`: SQL/DAB/browser with matching role assignment and paid private SQL infrastructure.

Do not substitute one profile for another. State unsupported combinations as gaps.

Run the profile's offline cost command with an explicit configuration. `demo-cost` applies only to the synthetic demo; `role-based-cost` applies to role-based data. Free allowances are not guaranteed zero cost. Unknown prices remain unknown, budgets are alerts rather than caps, and saved preferences are not spending approval.

For new demo SQL, use the explicitly approved `free-paused` or `paid-reviewed` policy. Free-paused must fail when unavailable; never retry as paid or enable overage automatically.

## Review before writes

Before any cloud mutation, present:

- subscription, tenant, resource group and region;
- application profile, identities and access model;
- images and billable resources;
- public exposure and data sensitivity;
- what-if result, recurring cost assumptions and cleanup path.

Preparation and read-only discovery are not write approval. Existing matching resources are collision information, not permission to reuse, rename, delete or replace the new application. An email address is not a tenant ID.

Use `npm run azure -- help` for the implemented surface. The project `init` command derives identity settings after approved sign-in; ask only for placement values it cannot derive. `deploy-all` may run its printed pending list only after explicit approval of that exact list and costs. Role assignment and smoke tests remain separately authorized.

Keep secrets out of chat, committed files and client configuration. Do not change subscription defaults, register providers, publish SQL, push images, create identities or assign roles without the matching approval.

## Prove the deployed result

Compilation, what-if, schema validation and mocks do not prove deployment. Verify live sign-in, intended role forwarding, two-user isolation where required, function identity for selected services, and the real application workflow. Report preparation, deployed resources and live acceptance separately.

Review actual usage, latency and availability before paid growth. Cleanup or export is a separate reviewed operation; never delete resources or data automatically.
