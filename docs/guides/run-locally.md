# Run locally

Run a browser app backed by SQL on your own computer. No Azure subscription is required. Complete [Get started](getting-started.md) first.

## Choose what to run

| What you are working on | Startup path |
| --- | --- |
| Your own data-only app | Follow [Build your app](build-your-app.md) and the data-only steps below; do not start excluded file/job services. |
| Your own app with files/jobs | Use the foundation startup below after implementing its screens, schema and authorization. |
| The included Todo reference | Follow the [Todo guide](../../examples/todo/README.md). It starts only SQL, DAB and the browser/API. |
| The foundation's file-processing demonstration | Use the startup below. It also starts local storage and Functions. |

The foundation is not a finished inventory or registration app. Its default browser demonstrates files and jobs; your domain screens need to be implemented.

## Approvals and readiness

The [setup coordinator](../reference/setup.md) connects these steps without
requiring a desktop executable. Run `npm run setup -- plan --profile <agreed-profile> --json`
before changing anything. After explicit approvals, `run` or `resume` rechecks
the checkout, skips current dependencies/builds and launches only that profile.
It never records grants automatically. The existing individual commands below
remain available; selected examples retain their separate application workflow.

Before the first approval, explain what stays separate: tool installations (only if missing) and anything in Azure. Everything else for local startup is one approval: `npm run setup -- approval --profile <agreed-profile>` lists restore, build, the workspace port block, image downloads, SQL startup, schema, services and the SQL terms line, with exclusions. After explicit approval run the printed `setup approve ... --approval <id>`, then `setup run`. Editing your application's SQL, DAB configuration or data profile reuses the approval; launcher, port or terms changes show a new id to review.

[Remembered local permissions](../reference/local-consent.md) store that approval per checkout and workspace across sessions. Grants are revocable, never global, and do not cover tool installations or Azure deployment.

If the approval control first returns "user unavailable" or is invisible, no approval was captured. Stop retrying that control. The assistant should provide one precise statement with the actual checkout, operations, effects and exclusions that you can send in ordinary chat. Wait for explicit consent before continuing.

Startup passes `ACCEPT_EULA=Y`; there is no chat dialog. Review the [container documentation/access instructions](https://aka.ms/azuresqldb-container) and applicable preview terms supplied with your registry access. The terms line in the setup approval permits the launcher to pass that value; it is not approval for other licenses.

Use the validation skill for current evidence and reporting. A proposed port/URL is unavailable until the intended server responds and readiness checks pass. Only then open/publish the launch URL. Verify the agreed browser save/reload action and SQL persistence separately; tests or a successful build do not replace it. If launch is blocked, the task is blocked, not complete.

Initial launch requires every dependency included in the selected profile. The foundation checks authorized SQL/DAB access, Blob/Queue metadata and authenticated Functions echo; data-only profiles do not require excluded services. A matching gateway that responds but is not ready is a setup blocker, not a launch success. Setup does not replace it automatically.

An early synthetic or mock-only shell is useful progress, not proof of SQL connectivity. Approve the visual direction before substantial UI work and review the actual desktop/mobile render when feasible.

## Run a data-only domain app

For a role-authorized domain app, use the [role-based-data profile](../reference/role-based-data.md): configure its dedicated application role and read-only readiness procedure, then use `npm run local -- role-based-app` after scoped build/workspace/startup approval. It starts SQL/DAB/browser only; `role-based-serve` resumes it. The product offers **Open local preview**, not a persona selector. Test identities are on a separate developer page; real Entra sign-in is an explicit local opt-in described in [Authentication and application access](../reference/authentication.md).

For advanced SQL-only work without this role-based profile, the existing individual steps remain available, with the scoped approvals above:

1. Restore/build as needed and select the workspace using `workspace-plan` and approved `workspace-init`.
2. Use `npm run local -- start-sql`, or `verify <selected-container>` for explicitly approved reuse.
3. Use `npm run local -- init` and `npm run local -- data`.
4. Start the gateway with `npm run local -- serve-sql`.

Pass the same optional SQL container name throughout when selecting a non-default container. `serve-sql` omits file/job adapters but does not generate domain screens, custom application roles or app-specific readiness checks. Remove excluded controls and verify the application's actual browser action, authorization and SQL save/reload. Do not run `app`, `services` or file-processing acceptance for this scope. The selected synthetic reference is not a role-authorized substitute.

## Start the foundation

From the project folder:

```powershell
npm ci
npm run build
npm run local -- workspace-plan
```

Review the proposed port block. Select it by replacing `<base-port>` with the reported value:

```powershell
npm run local -- workspace-init <base-port>
npm run local -- app
```

Workspace selection keeps this checkout's service names, ports and saved state separate. Startup downloads missing images, accepts the SQL container EULA, publishes the project schema and launches services. Read the [local runtime reference](../reference/local-development.md) before reusing an existing stack or database.

The workspace and startup commands above are covered by the single `setup approval` bundle; with the individual commands you can instead record scopes from their [consent plans](../reference/local-consent.md). Use the guarded `consent run restore`/`consent run build` paths for assistant-led work; raw package commands are not permission bypasses.

After the intended server responds and `/health/ready` passes, open its reported browser URL and select **Open local preview**. For the approved foundation file/job demonstration, upload a small text file and select **Process file**. The completed job shows byte count and SHA-256. Test two-user ownership separately by opening the reported local-only developer page in the same tab, switching the test identity, and returning to confirm that the other user's files and jobs are absent.

Preview identities are simulations, not production sign-in. Keep the local app and DAB on loopback; do not expose them to other computers. See the [authentication boundaries](../reference/authentication.md#three-distinct-boundaries) for how preview, real local Entra sign-in and cloud backend identity differ.

For your own application, try its main action and reload to check persistence. Use test data, not sensitive production records.

## Stop and return later

Press **Ctrl+C** in the browser-server terminal. SQL and storage data remain saved; their containers may still be running.

To resume against those services:

```powershell
npm run local -- serve
```

To stop the foundation worker and storage without deleting their data:

```powershell
npm run local -- stop-services
```

After stopping foundation services, use `app` to start them again. Role-authorized data-only apps resume with `role-based-serve`; advanced SQL-only work uses `serve-sql` against running SQL/DAB, not foundation `serve` or `app`. Selected-reference commands have their own stop/resume steps in the Todo guide. Do not delete volumes or saved credentials to restart an app. In preview mode, open local preview again after a gateway restart; SQL and storage data persist independently of the session.

`serve` only resumes the gateway against existing services. It tries readiness three times, with one-second pauses and a four-second shared deadline per attempt, then reports the named failure without listening or publishing a ready URL. It never starts or restarts a dependency. Inspect the failure before separately approved recovery; full `app`/`services` startup can recreate owned services and is not a diagnostic retry.

If a worker fails after successful launch, keep the gateway running. Readiness becomes HTTP 503 while liveness remains HTTP 200, and queued jobs remain durable. Submission can still work while SQL and storage are available; configured controls do not guarantee that every service is currently healthy. Readiness recovers on the next successful probe without a gateway restart.

## When something fails

Read the named failed startup stage before retrying. Common first checks:

- **Tool not found:** reopen the terminal after installation and run the setup check again.
- **Docker unavailable:** start its Linux-container engine.
- **SQL image unauthorized:** complete preview access in your own terminal.
- **Port occupied:** identify the existing app; do not stop an unrelated process.
- **SQL or processing error:** use the [local runtime reference](../reference/local-development.md) for the affected service's diagnostics and recovery.
- **Readiness names `data`, `blob`, `queue` or `functions`:** inspect that dependency before requesting recovery. Anonymous DAB aggregate health is not proof that the authorized SQL query failed.

For deeper checks, use the [local runtime reference](../reference/local-development.md). Test commands that create fixtures or restart services are described there so you can choose when to run them.
