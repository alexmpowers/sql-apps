---
name: sql-apps-diagnostics
description: "Use when a SQL Apps local service, startup, readiness probe, file-processing job, retry, maintenance task or trace dashboard is failing."
---

# Diagnose SQL Apps locally

Resolve `../../scripts/sql-apps.mjs` from this installed skill and run its absolute path with `home`. Confirm the application checkout with `workspace-check`; do not inspect a plugin cache, guess another checkout or overwrite a mismatch.

Read `docs/reference/local-development.md` for the failing subsystem only. Run `setup status --profile <agreed-profile> --json` and `status`. Report the first named blocker and the command that continues after it. HTTP health does not prove SQL permissions, storage, worker behavior or browser acceptance.

## Find the cause

1. Reproduce the failing action. Keep a positive control when testing authorization, Origin or validation.
2. Inspect only project-owned bounded logs, workspace state and documented containers. Do not dump environment variables, credential state or private files.
3. For prerequisites, use `setup-check`. Distinguish missing, unsupported and broken installed tools; none grants installation permission.
4. Check `local-settings.json` at the workspace path reported by `workspace-check`. Invalid settings fail explicitly and require the affected services to restart.
5. For jobs, use the signed-in user's status and trace dashboard. A retry creates a new parent-linked job; obtain approval before submitting it. Missing snapshots require reupload.
6. Restart only the affected owned service after identifying the cause, then repeat the same action.

Use `setup resume` after fixing a setup blocker. Do not reinstall tools, reset volumes, regenerate credentials, disable authentication, kill processes by name or switch to Azure as a troubleshooting shortcut.

SQL recovery and maintenance are separate mutations. Show their consent plan and obtain one-operation approval. Recovery preserves the selected image, credentials, ports and labeled data; retention may delete data. Resume interrupted recovery without printing sensitive state.

Keep resolved failures as history, but separate them from current blockers. If source changed during a comparison, report the difference; never reset another writer's work or replace the baseline.

Trace records are owner-scoped and omit file contents and credentials. SQL, Blob and Queue are not one atomic transaction, so do not promise exactly-once delivery.

If an approval or completion control is unavailable, say so and wait for explicit consent or report ordinary evidence. Tool failure is never approval.
