---
name: sql-apps-local
description: "Use when checking prerequisites, starting, resuming or stopping a SQL Apps application locally, or selecting its local SQL container and workspace."
---

# Run SQL Apps locally

Resolve `../../scripts/sql-apps.mjs` from this installed skill and use its absolute path. Run `home`, then confirm the intended application checkout. Never run from a plugin cache or silently rebind another checkout.

This skill owns local prerequisites and lifecycle. Use `sql-apps-application` for domain code, `sql-apps-diagnostics` for an existing failure and `sql-apps-cloud-preview` for sharing. Do not load cloud cost or deployment guidance during local startup.

## Plan the next action

Read `docs/guides/getting-started.md` and `docs/reference/local-development.md` only as needed for the current blocker. Run:

```powershell
node "<absolute-script-path>" guide
node "<absolute-script-path>" setup plan --profile <agreed-profile> --json
```

Choose `role-based-data` for SQL/DAB/browser-only scope or `foundation` when files or background jobs were agreed. Stop gathering context when the plan names the next action or blocker.

The setup coordinator probes prerequisites and is the source of truth for restore, build, workspace, startup, SQL terms and resume state. Use the standalone prerequisite diagnostic only when the plan directs you to diagnose a tool or access failure. Show the plan before approval. After explicit approval, run its printed `setup approve` command, then `setup run`; use `setup resume` after a stop or corrected blocker. Never manufacture a grant, bypass a blocker, repeat completed work or treat a nonzero result as success.

If approval controls are unavailable, state that no approval was captured and wait for an explicit scoped statement in chat. Generic autonomy is not consent.

## Missing tools

For a missing tool, use `setup install-plan <tool>`. Explain its source, command, downloads, disk or privilege effects and expected continuation. Execute the unchanged absolute plan only after explicit approval.

Do not replace compatible tools, bootstrap a package manager, overwrite version managers, auto-accept licenses, elevate, reboot, change Docker permissions or disable security controls. Human installer, credential, license and restart steps remain pauses. Credentials are entered in their own terminal, never chat or repository files.

Azure SQL local is a private preview and requires approved registry access unless a usable image or container already exists. Do not substitute another SQL engine.

## Start or reuse

Run `workspace-check` before lifecycle commands. A source, binding, workspace or provenance mismatch needs an explicit application selection; never copy uncommitted source or overwrite state to make it match.

Reuse a responding service only when `/local/workspace` and `/health/ready` identify the intended checkout, source, workspace, profile, authentication and SQL container. A proposed URL or HTTP liveness alone is not a usable app.

Use only the profile selected from the application scope:

- `role-based-app` and `role-based-serve`: SQL/DAB/browser for role-based data.
- `app` and `serve`: full approved foundation.
- `serve-sql`: advanced SQL-only work.

Keep commands attached. Preserve SQL and Blob data on stop. Never reset volumes, regenerate credentials, stop unrelated processes or adopt a mismatched container. Recovery, maintenance, retention and destructive cleanup require their own reviewed plan and approval.

Optional examples are a separate explicit choice. Keep root `selectedExamples: []`; do not suggest, restore or run an excluded example.

## Verify completion

Publish a launch URL only after the intended server and readiness probe respond. Open that origin and verify the agreed browser action plus SQL save/reload. Verify files or jobs only when selected.

Give the verified URL, user flow, Ctrl+C behavior and profile-matched resume/stop command. Use `sql-apps-validation` for workflow evidence. Local preview identities are simulated; product screens use account/access states and keep test identities on the developer page.

A useful local app is success. No Azure subscription or cloud deployment is required.
