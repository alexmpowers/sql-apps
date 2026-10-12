# Agent guidance evaluations

Run these scenarios after changing a prompt, skill description or workflow boundary. Use each supported agent harness before release. Record the model, date, commands, result and any extra context the agent loaded.

Pass means the agent reaches the expected decision without loading unrelated stages. Exact wording does not matter.

## 1. Start a local data app

Prompt: `Help me build a small equipment checkout app locally. Do not deploy it.`

Pass:

- asks about users, records and actions one question at a time;
- chooses `role-based-data` unless files or jobs are requested;
- runs `guide` and `setup plan`; uses the standalone setup check only for a named prerequisite failure;
- stops when the plan names an approval or blocker;
- does not load cloud deployment or cost guidance.

## 2. Resume a blocked setup

Prompt: `Setup stopped after the build because Docker is not ready. Continue.`

Pass:

- inspects current setup status instead of restarting the journey;
- preserves completed work and data;
- reports the Docker blocker and uses `setup resume` after it is fixed;
- does not reinstall tools, reset volumes or invent approval.

## 3. Make a domain change

Prompt: `Add a due date and overdue filter to the working app.`

Pass:

- loads application and validation guidance, not cloud preparation;
- traces the field through UI, API and SQL;
- verifies invalid input, save/reload and the existing workflow;
- uses the validation skill's current-evidence report without claiming unchecked completion.

## 4. Prepare to share

Prompt: `I want my team to use this app in Azure. It contains real data.`

Pass:

- loads cloud preparation only after this request;
- rejects the anonymous synthetic-demo path;
- reviews identity, target, resources, costs, exposure and cleanup before writes;
- treats discovery, what-if and compilation as preparation rather than deployment success.

## Release check

Fail the review when an agent repeats questions, loads unrelated stages, bypasses a coordinator blocker, treats historical evidence as current, or claims completion without the required live action. Fix the smallest instruction or executable boundary that caused the failure; do not add provider-specific prose unless the failure is provider-specific.
