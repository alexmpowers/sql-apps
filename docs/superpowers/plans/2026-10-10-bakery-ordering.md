# Bakery Online Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and locally verify a guest bakery ordering application with staff-only catalog, pickup-slot, order, and payment management.

**Architecture:** Extend the selected-application runtime with an explicit `hybrid` access mode. The hybrid adapter combines hashed visitor sessions for public customer routes with gateway-verified local staff sessions and distinct Data API Builder roles; Azure SQL remains authoritative for prices, cutoff/capacity, idempotency, and lifecycle transitions.

**Tech Stack:** TypeScript 5.9, Node.js 22/24, Fastify 5, Zod 4, Azure SQL Database project, T-SQL stored procedures, Data API Builder 2.0.12, Node test runner, esbuild.

---

## Scope and Working Rules

- Implement the bakery as a new explicitly selected application under `examples/bakery/`. Do not copy Todo names, tables, routes, or tests.
- Support `local-simulation` only. Do not add a deployment profile or Azure infrastructure.
- Use synthetic customer details in all tests and acceptance.
- Preserve the current dirty worktree. Stage and commit only files named by each task.
- Follow red-green-refactor: every behavior starts with a failing test, then the smallest implementation, then focused and containing-suite verification.
- If a defect appears during acceptance, add the smallest reproducing regression before changing implementation.

## File Structure

### Shared selected-application runtime

- Modify `src/application.ts`: add the selected access-mode contract and role-aware procedure execution.
- Create `src/hybrid-app.ts`: compose visitor sessions with local staff identity verification and role-specific DAB calls.
- Modify `src/demo-app.ts`: expose the reusable visitor adapter without changing Todo behavior.
- Modify `src/application-build.ts`: validate access mode, bundle the correct adapter, and preserve it in the manifest.
- Modify `src/selected-local.ts`: derive an AppService-simulation DAB config for hybrid local artifacts and pass the local identity options to the app.
- Modify `tests/application-build.test.ts`, `tests/selected-local.test.ts`: lock down artifact and local-config behavior.
- Create `tests/hybrid-app.test.ts`: verify guest/staff separation, forged-header rejection, Alice authorization, and Bob denial.

### Bakery application

- Create `examples/bakery/contract.ts`: Zod request/response schemas and shared domain types.
- Create `examples/bakery/application.ts`: exact route contract, procedure allowlist, backend result parsing, and safe error mapping.
- Create `examples/bakery/web/client.ts`: typed browser client.
- Create `examples/bakery/web/app.ts`: customer and staff controllers and DOM rendering.
- Create `examples/bakery/web/index.html`: semantic customer/staff page structure.
- Create `examples/bakery/web/app.css`: responsive accessible presentation.
- Create `examples/bakery/sql/schema.sql`: durable tables, constraints, indexes, and session storage.
- Create `examples/bakery/sql/customer-procedures.sql`: session, catalog, slot, quote, and atomic placement procedures.
- Create `examples/bakery/sql/staff-procedures.sql`: staff catalog, slot, queue, status, and payment procedures.
- Create `examples/bakery/sql/database.sqlproj`: Azure SQL project.
- Create `examples/bakery/sql/grants.sql`: execute/view-definition grants only.
- Create `examples/bakery/dab-config.json`: stored-procedure-only entities with `BakeryCustomer` and `BakeryStaff` roles.
- Create `examples/bakery/tests/contract.test.ts`: boundary validation.
- Create `examples/bakery/tests/composition.test.ts`: route-to-procedure and error-contract tests.
- Create `examples/bakery/tests/client.test.ts`: browser-client request and response tests.
- Create `examples/bakery/tests/sql-contract.test.ts`: static schema/DAB/grant invariants.
- Create `examples/bakery/tests/web.test.ts`: semantic HTML and accessibility invariants.
- Create `examples/bakery/acceptance.mjs`: real local SQL/DAB/gateway concurrency, permission, persistence, and cleanup checks.
- Create `examples/bakery/README.md`: exact local build, startup, acceptance, stop, and resume commands.

## Task 1: Add an Explicit Hybrid Selected-App Contract

**Files:**
- Modify: `src/application.ts`
- Modify: `src/application-build.ts`
- Modify: `tests/application-build.test.ts`

- [ ] **Step 1: Write the failing access-mode manifest test**

Keep the existing inventory fixture as a visitor/public-demo fixture by adding `access: 'visitor'`. Extend the fixture directory list with `examples/hybrid/web` and `examples/hybrid/demo`, copy the same minimal browser/SQL/DAB fixture files into that tree, and write this separate definition:

```ts
export const application: ApplicationDefinition = {
  name: 'hybrid',
  access: 'hybrid',
  capabilities: ['data', 'visitor-sessions', 'staff-sessions'],
  profiles: ['local-simulation'],
  routes: [{ method: 'GET', path: '/hybrid' }],
  inputs: {
    browser: 'web/app.ts',
    html: 'web/index.html',
    css: 'web/app.css',
    sqlProject: 'demo/database.sqlproj',
    sqlFiles: ['demo/schema.sql'],
    grants: 'demo/grants.sql',
    dab: 'demo/dab-config.json',
  },
  procedures: ['CreateSession', 'GetSession', 'DeleteSession', 'Readiness'],
  sessions: { create: 'CreateSession', get: 'GetSession', delete: 'DeleteSession', ready: 'Readiness' },
  async register(app) { app.get('/hybrid', async () => ({ items: [] })); },
};
```

Add a separate test so the existing public-demo provenance assertions remain unchanged:

```ts
test('hybrid selected builds are local-only and preserve access mode', async t => {
  const home = await fixture();
  t.after(() => rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const built = await buildSelectedApplication(home, 'hybrid', 'local-simulation');
  assert.equal(built.manifest.access, 'hybrid');
  assert.deepEqual(built.manifest.profiles, ['local-simulation']);
  await assert.rejects(buildSelectedApplication(home, 'hybrid', 'public-demo'), /profile/);
});
```

- [ ] **Step 2: Run the focused test and verify the schema rejects the new property**

Run:

```powershell
npx tsc
node --test dist/tests/application-build.test.js
```

Expected: FAIL because `ApplicationDefinition` and the strict build metadata do not accept `access`.

- [ ] **Step 3: Add the access and role-aware execution types**

In `src/application.ts`, add:

```ts
export type ApplicationAccess = 'visitor' | 'hybrid';
export type ApplicationRole = string;

export interface StaffIdentity {
  oid: string;
  name: string;
  roles: readonly string[];
}

export interface ApplicationServices {
  subject(request: FastifyRequest): Promise<string>;
  staff?: (request: FastifyRequest) => Promise<StaffIdentity>;
  execute(name: string, parameters: ProcedureParameters, role?: ApplicationRole): Promise<unknown>;
}

export interface ApplicationDefinition {
  name: string;
  access: ApplicationAccess;
  capabilities: readonly string[];
  profiles: readonly ApplicationProfile[];
  routes: readonly ApplicationRoute[];
  inputs: {
    browser: string;
    html: string;
    css: string;
    sqlProject: string;
    sqlFiles: readonly string[];
    grants: string;
    dab: string;
  };
  procedures: readonly string[];
  sessions: { create: string; get: string; delete: string; ready: string };
  register(app: FastifyInstance, services: ApplicationServices): Promise<void>;
}
```

Add `access: z.enum(['visitor', 'hybrid'])` to `metadata` in `src/application-build.ts`. During build inspection, provide a staff stub only for hybrid definitions:

```ts
const inspectionAdapter: ApplicationAdapter = {
  profile: supported,
  capabilities: definition.capabilities,
  async register() {},
  async ready() {},
  async subject() { throw new Error('Build inspection cannot authorize a visitor request'); },
  async execute() { throw new Error('Build inspection cannot execute data procedures'); },
  ...(definition.access === 'hybrid' ? {
    async staff() { throw new Error('Build inspection cannot authorize a staff request'); },
  } : {}),
};
```

Require:

```ts
if (definition.access === 'hybrid' &&
    (!definition.capabilities.includes('visitor-sessions') || !definition.capabilities.includes('staff-sessions'))) {
  throw new Error('Hybrid selected applications require visitor-sessions and staff-sessions capabilities');
}
if (definition.access === 'visitor' && definition.capabilities.includes('staff-sessions')) {
  throw new Error('Visitor selected applications cannot declare staff-sessions');
}
```

Add `access: 'visitor'` to `examples/todo/application.ts` and every existing selected-app fixture definition. Add `access: 'hybrid'` only to the new hybrid fixture.

- [ ] **Step 4: Run the selected build tests**

Run:

```powershell
npx tsc
node --test dist/tests/application-build.test.js dist/examples/todo/tests/composition.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```powershell
git add src/application.ts src/application-build.ts tests/application-build.test.ts examples/todo/application.ts examples/todo/tests/composition.test.ts
git commit -m "feat: define hybrid selected app access" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Build the Hybrid Visitor and Staff Adapter

**Files:**
- Create: `src/hybrid-app.ts`
- Modify: `src/demo-app.ts`
- Modify: `src/application-build.ts`
- Create: `tests/hybrid-app.test.ts`

- [ ] **Step 1: Write failing hybrid-boundary tests**

Create `tests/hybrid-app.test.ts` with a minimal hybrid definition and assertions for:

```ts
const definition: ApplicationDefinition = {
  name: 'hybrid-test',
  access: 'hybrid',
  capabilities: ['data', 'visitor-sessions', 'staff-sessions'],
  profiles: ['local-simulation'],
  routes: [{ method: 'GET', path: '/staff-check' }],
  inputs: {
    browser: 'web/app.ts',
    html: 'web/index.html',
    css: 'web/app.css',
    sqlProject: 'sql/database.sqlproj',
    sqlFiles: ['sql/schema.sql'],
    grants: 'sql/grants.sql',
    dab: 'dab-config.json',
  },
  procedures: ['CreateSession', 'GetSession', 'DeleteSession', 'Readiness'],
  sessions: { create: 'CreateSession', get: 'GetSession', delete: 'DeleteSession', ready: 'Readiness' },
  async register(app, services) {
    app.get('/staff-check', async request => {
      if (!services.staff) throw new ApplicationError(500, 'Staff identity service unavailable');
      return services.staff(request);
    });
  },
};

test('hybrid app separates visitor and staff identities', async t => {
  const forwarded: { name: string; role: string | undefined }[] = [];
  const app = await createHybridApplication(definition, {
    profile: 'local-simulation',
    origin: 'http://127.0.0.1:43100',
    dabUrl: 'http://127.0.0.1:43101',
    staffUsers: [
      { id: 'alice', name: 'Development Alice', roles: ['BakeryStaff'] },
      { id: 'bob', name: 'Development Bob', roles: [] },
    ],
  }, async (url, init) => {
    const name = new URL(String(url)).pathname.split('/').at(-1) ?? '';
    forwarded.push({ name, role: new Headers(init?.headers).get('x-ms-api-role') ?? undefined });
    return Response.json({ value: name === 'Readiness'
      ? [{ status: 'ready', schema_version: 1 }]
      : [{ outcome: 'ok', expires_at: '2099-01-01T00:00:00Z' }] });
  });
  t.after(() => app.close());

  const visitor = await app.inject({
    method: 'POST',
    url: '/session',
    headers: { host: '127.0.0.1:43100', origin: 'http://127.0.0.1:43100' },
    payload: { synthetic: true },
  });
  assert.equal(visitor.statusCode, 201);

  const alice = await app.inject({
    method: 'POST',
    url: '/staff/session',
    headers: { host: '127.0.0.1:43100', origin: 'http://127.0.0.1:43100' },
    payload: { user: 'alice' },
  });
  assert.equal(alice.statusCode, 200);
  const token = alice.json().token;
  assert.equal((await app.inject({ url: '/staff-check', headers: { authorization: `Bearer ${token}` } })).statusCode, 200);

  const bob = await app.inject({
    method: 'POST',
    url: '/staff/session',
    headers: { host: '127.0.0.1:43100', origin: 'http://127.0.0.1:43100' },
    payload: { user: 'bob' },
  });
  assert.equal((await app.inject({
    url: '/staff-check',
    headers: { authorization: `Bearer ${bob.json().token}` },
  })).statusCode, 403);
});
```

Also assert that `x-ms-client-principal` and `x-ms-api-role` on an incoming request produce 403, missing/expired staff tokens produce 401, and `/staff/session` is unavailable when `NODE_ENV=production`.

- [ ] **Step 2: Run the focused test and verify the adapter is missing**

Run:

```powershell
npx tsc
node --test dist/tests/hybrid-app.test.js
```

Expected: FAIL because `src/hybrid-app.ts` does not exist.

- [ ] **Step 3: Extract the reusable visitor adapter**

In `src/demo-app.ts`, extract the current adapter construction into:

```ts
export async function createVisitorAdapter(
  definition: ApplicationDefinition,
  options: DemoOptions,
  fetcher: typeof fetch = fetch,
): Promise<ApplicationAdapter> {
  return adapter;
}

export async function createDemoApplication(
  definition: ApplicationDefinition,
  options: DemoOptions,
  fetcher: typeof fetch = fetch,
): Promise<FastifyInstance> {
  return composeApplication(definition, await createVisitorAdapter(definition, options, fetcher), options.publicDirectory);
}
```

Move the complete existing origin checks, cookie selection, procedure allowlist, `execute`, `subject`, `ready`, and session-route `register` implementation into `createVisitorAdapter` without changing any branch or error message. The wrapper shown above must be the only replacement in `createDemoApplication`; the Todo regression test in Step 6 proves behavior was preserved.

- [ ] **Step 4: Implement the hybrid adapter**

Create `src/hybrid-app.ts`. Use `randomBytes(32).toString('base64url')` for staff tokens, an in-memory map with eight-hour expiry, `bearerToken` for parsing, and `ApplicationError` for safe 401/403 responses:

```ts
export interface HybridOptions extends DemoOptions {
  staffUsers: readonly { id: string; name: string; roles: readonly string[] }[];
}

export async function createHybridApplication(
  definition: ApplicationDefinition,
  options: HybridOptions,
  fetcher: typeof fetch = fetch,
): Promise<FastifyInstance> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Hybrid local identity simulation is disabled in production');
  }
  if (definition.access !== 'hybrid' || options.profile !== 'local-simulation') {
    throw new Error('Hybrid selected applications support local-simulation only');
  }
  const base = await createVisitorAdapter(definition, options, fetcher);
  const sessions = new Map<string, { user: HybridOptions['staffUsers'][number]; expires: number }>();
  const originalRegister = base.register.bind(base);
  const visitorExecute = base.execute.bind(base);
  base.execute = (name, parameters, role = 'BakeryCustomer') =>
    visitorExecute(name, parameters, role);

  base.staff = async request => {
    const token = bearerToken(request.headers.authorization);
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expires <= Date.now()) {
      if (token) sessions.delete(token);
      throw new ApplicationError(401, 'Select a development staff user');
    }
    if (!session.user.roles.includes('BakeryStaff')) {
      throw new ApplicationError(403, 'BakeryStaff role required');
    }
    return { oid: session.user.id, name: session.user.name, roles: session.user.roles };
  };

  base.register = async app => {
    await originalRegister(app);
    app.get('/staff/config', async () => ({
      mode: 'local',
      users: options.staffUsers.map(user => ({ id: user.id, name: user.name })),
      requiredRole: 'BakeryStaff',
    }));
    app.post('/staff/session', async (request, reply) => {
      const parsed = z.strictObject({ user: z.string() }).safeParse(request.body);
      const user = parsed.success ? options.staffUsers.find(candidate => candidate.id === parsed.data.user) : undefined;
      if (!user) throw new ApplicationError(400, 'Choose a configured development user');
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { user, expires: Date.now() + 8 * 60 * 60 * 1000 });
      return reply.send({ token });
    });
    app.delete('/staff/session', async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      if (token) sessions.delete(token);
      return reply.code(204).send();
    });
    app.addHook('onClose', async () => { sessions.clear(); });
  };
  return composeApplication(definition, base, options.publicDirectory);
}
```

In the visitor adapter's `execute`, send role headers only on internal DAB calls:

```ts
const headers = new Headers({ 'content-type': 'application/json' });
if (role) {
  headers.set('x-ms-api-role', role);
  headers.set('x-ms-client-principal', localPrincipal(
    role === 'BakeryStaff' ? '11111111-1111-4111-8111-111111111111' : '00000000-0000-4000-8000-000000000000',
    'access_as_user',
    role,
  ));
}
```

Reject those two headers when received from the browser, as the existing visitor adapter already does.

- [ ] **Step 5: Bundle the adapter selected by access mode**

In `src/application-build.ts`, replace the fixed factory import in the esbuild stdin with:

```ts
import { application } from ${JSON.stringify(`./examples/${name}/application.ts`)};
import { createDemoApplication } from './src/demo-app.ts';
import { createHybridApplication } from './src/hybrid-app.ts';
export { application };
export const createApplication = (options, fetcher) =>
  application.access === 'hybrid'
    ? createHybridApplication(application, options, fetcher)
    : createDemoApplication(application, options, fetcher);
```

Ensure the generated `start.mjs` supplies Alice and Bob:

```ts
const staffUsers = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Development Alice', roles: ['BakeryStaff'] },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Development Bob', roles: [] },
];
const app = await createApplication({
  profile,
  origin: process.env.PUBLIC_ORIGIN,
  dabUrl: process.env.DAB_URL,
  publicDirectory: 'public',
  staffUsers,
});
```

- [ ] **Step 6: Run adapter and regression tests**

Run:

```powershell
npx tsc
node --test dist/tests/hybrid-app.test.js dist/tests/application-build.test.js dist/examples/todo/tests/composition.test.js
```

Expected: PASS, including unchanged Todo visitor behavior.

- [ ] **Step 7: Commit the hybrid adapter**

```powershell
git add src/hybrid-app.ts src/demo-app.ts src/application-build.ts tests/hybrid-app.test.ts
git commit -m "feat: add hybrid selected app adapter" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Generate Role-Aware Local DAB Configuration

**Files:**
- Modify: `src/selected-local.ts`
- Modify: `tests/selected-local.test.ts`

- [ ] **Step 1: Write the failing local-config test**

Add a test that calls an exported pure helper:

```ts
test('hybrid local config enables AppService simulation without widening entities', () => {
  const source = {
    runtime: {
      host: { mode: 'production', authentication: { provider: 'AzureAD' } },
      graphql: { enabled: false },
      mcp: { enabled: false },
    },
    entities: {
      Catalog: {
        source: { object: 'dbo.BakeryCatalog', type: 'stored-procedure' },
        permissions: [{ role: 'BakeryCustomer', actions: ['execute'] }],
      },
      StaffOrders: {
        source: { object: 'dbo.BakeryStaffOrders', type: 'stored-procedure' },
        permissions: [{ role: 'BakeryStaff', actions: ['execute'] }],
      },
    },
  };
  const local = selectedLocalDabConfig(source, 'hybrid');
  assert.deepEqual(local.runtime.host, {
    mode: 'development',
    authentication: { provider: 'AppService' },
  });
  assert.deepEqual(Object.keys(local.entities), ['Catalog', 'StaffOrders']);
  assert.deepEqual(source.runtime.host.authentication, { provider: 'AzureAD' });
});
```

- [ ] **Step 2: Run the focused test and verify the helper is absent**

Run:

```powershell
npx tsc
node --test dist/tests/selected-local.test.js
```

Expected: FAIL because `selectedLocalDabConfig` is not exported.

- [ ] **Step 3: Implement immutable local transformation**

In `src/selected-local.ts`:

```ts
export function selectedLocalDabConfig(source: unknown, access: ApplicationBuildManifest['access']): unknown {
  const config = z.object({
    runtime: z.object({
      host: z.object({ mode: z.string(), authentication: z.object({ provider: z.string() }).passthrough() }),
    }).passthrough(),
    entities: z.record(z.string(), z.unknown()),
  }).passthrough().parse(structuredClone(source));
  if (access === 'hybrid') {
    config.runtime.host = { mode: 'development', authentication: { provider: 'AppService' } };
  }
  return config;
}
```

In `prepareSelectedLocalApplication`, parse the artifact JSON once and save the transformed object to the workspace state config. Compare an existing container against the transformed object, not the artifact text.

- [ ] **Step 4: Run selected-local tests**

Run:

```powershell
npx tsc
node --test dist/tests/selected-local.test.js dist/tests/application-build.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit local DAB simulation**

```powershell
git add src/selected-local.ts tests/selected-local.test.ts
git commit -m "feat: configure hybrid DAB roles locally" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Define Bakery Contracts and Boundary Tests

**Files:**
- Create: `examples/bakery/contract.ts`
- Create: `examples/bakery/tests/contract.test.ts`

- [ ] **Step 1: Write failing contract tests**

Cover exact limits:

```ts
test('guest and basket boundaries are exact', () => {
  const valid = {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    pickupSlotId: '22222222-2222-4222-8222-222222222222',
    quotedTotal: '400.00',
    guest: { name: 'Synthetic Guest', email: 'GUEST@EXAMPLE.TEST', phone: '+1 (555) 010-9999' },
    lines: Array.from({ length: 20 }, (_, index) => ({
      productId: '33333333-3333-4333-8333-333333333333',
      quantity: 20,
      optionIds: index ? [] : ['44444444-4444-4444-8444-444444444444'],
    })),
  };
  const parsed = placeOrderSchema.parse(valid);
  assert.equal(parsed.guest.email, 'guest@example.test');
  assert.equal(parsed.guest.phone, '+15550109999');
  assert.equal(parsed.lines.length, 20);
  assert.throws(() => placeOrderSchema.parse({ ...valid, lines: [...valid.lines, valid.lines[0]] }));
  assert.throws(() => placeOrderSchema.parse({
    ...valid,
    lines: [{ ...valid.lines[0], quantity: 21 }],
  }));
});
```

Also test a 100-character name succeeds, 101 fails, a 254-character syntactically valid email succeeds, 255 fails, phone digit counts 7 and 15 succeed, 6 and 16 fail, duplicate option IDs fail, and duplicate product/option combinations fail as duplicate lines.

- [ ] **Step 2: Run the focused test and verify the contract is absent**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/contract.test.js
```

Expected: TypeScript compilation fails because `examples/bakery/contract.ts` is absent.

- [ ] **Step 3: Implement shared schemas**

Create schemas with these exported names:

```ts
export const id = z.string().uuid();
export const money = z.string().regex(/^(?:0|[1-9]\d{0,7})\.\d{2}$/);
export const guestName = z.string().trim().min(1).max(100);
export const guestEmail = z.string().trim().toLowerCase().email().max(254);
export const guestPhone = z.string().transform(value => {
  const trimmed = value.trim();
  const leading = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new Error('Phone must contain 7 to 15 digits');
  return `${leading}${digits}`;
});
export const orderLineInputSchema = z.strictObject({
  productId: id,
  quantity: z.number().int().min(1).max(20),
  optionIds: z.array(id).max(20).refine(values => new Set(values).size === values.length),
});
export const placeOrderSchema = z.strictObject({
  idempotencyKey: id,
  pickupSlotId: id,
  quotedTotal: money,
  guest: z.strictObject({ name: guestName, email: guestEmail, phone: guestPhone }),
  lines: z.array(orderLineInputSchema).min(1).max(20),
}).superRefine((value, context) => {
  const keys = value.lines.map(line =>
    `${line.productId}:${[...line.optionIds].sort().join(',')}`);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'Duplicate basket lines are not accepted' });
  }
});
```

Also export strict schemas for catalog products/options, pickup slots, quote response, order confirmation, staff queue rows, catalog mutations, slot mutations, lifecycle transitions, and payment transitions. Use enum values:

```ts
export const orderStatus = z.enum(['New', 'Confirmed', 'Ready', 'PickedUp', 'Canceled']);
export const paymentStatus = z.enum(['Unpaid', 'Paid']);
```

- [ ] **Step 4: Run contract tests**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit bakery contracts**

```powershell
git add examples/bakery/contract.ts examples/bakery/tests/contract.test.ts
git commit -m "feat: define bakery application contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Create the Bakery SQL Schema

**Files:**
- Create: `examples/bakery/sql/database.sqlproj`
- Create: `examples/bakery/sql/schema.sql`
- Create: `examples/bakery/tests/sql-contract.test.ts`

- [ ] **Step 1: Write failing schema-contract tests**

Read `schema.sql` and assert it contains:

```ts
assert.match(schema, /CREATE TABLE dbo\.BakeryVisitorSessions/i);
assert.match(schema, /token_hash char\(64\).*PRIMARY KEY/is);
assert.match(schema, /CREATE TABLE dbo\.BakeryProducts/i);
assert.match(schema, /CREATE TABLE dbo\.BakeryProductOptions/i);
assert.match(schema, /CREATE TABLE dbo\.BakeryPickupSlots/i);
assert.match(schema, /CREATE TABLE dbo\.BakeryOrders/i);
assert.match(schema, /CREATE TABLE dbo\.BakeryOrderItems/i);
assert.match(schema, /CREATE TABLE dbo\.BakeryOrderItemOptions/i);
assert.match(schema, /UNIQUE.*confirmation_code/is);
assert.match(schema, /UNIQUE.*idempotency_key/is);
assert.match(schema, /decimal\(12,2\)/i);
assert.doesNotMatch(schema, /\bfloat\b|\breal\b|ON DELETE CASCADE.*BakeryOrders/is);
```

- [ ] **Step 2: Run and verify the missing schema fails**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: FAIL with `ENOENT` for `schema.sql`.

- [ ] **Step 3: Create the SQL project and schema**

Use Azure SQL target:

```xml
<Project Sdk="Microsoft.Build.Sql/2.3.0">
  <PropertyGroup>
    <Name>SqlAppsBakery</Name>
    <DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP>
    <TreatTSqlWarningsAsErrors>true</TreatTSqlWarningsAsErrors>
  </PropertyGroup>
  <ItemGroup>
    <Build Remove="grants.sql" />
  </ItemGroup>
</Project>
```

Define:

- `BakeryVisitorSessions(token_hash char(64), expires_at datetime2(3), created_at datetime2(3))`
- `BakeryProducts(id uniqueidentifier, name nvarchar(100), description nvarchar(1000), base_price decimal(12,2), is_active bit, is_available bit, created_at, updated_at)`
- `BakeryOptionGroups(id, product_id, name nvarchar(100), is_required bit, is_active bit)`
- `BakeryProductOptions(id, group_id, name nvarchar(100), price_adjustment decimal(12,2), is_active bit)`
- `BakeryPickupSlots(id, starts_at datetime2(3), ends_at datetime2(3), cutoff_at datetime2(3), order_limit smallint, is_active bit, row_version rowversion)`
- `BakeryOrders(id, confirmation_code char(10), idempotency_key uniqueidentifier, request_hash char(64), visitor_session_hash char(64), guest_name nvarchar(100), guest_email nvarchar(254), guest_phone varchar(16), pickup_slot_id, pickup_starts_at datetime2(3), total decimal(12,2), order_status varchar(16), payment_status varchar(8), created_at, updated_at)`
- `BakeryOrderItems(id, order_id, product_id nullable, product_name nvarchar(100), base_price decimal(12,2), quantity tinyint, unit_total decimal(12,2), line_total decimal(12,2))`
- `BakeryOrderItemOptions(order_item_id, option_id nullable, group_name nvarchar(100), option_name nvarchar(100), price_adjustment decimal(12,2))`

Add checks for nonnegative prices, quantity 1-20, `starts_at < ends_at`, `cutoff_at <= starts_at`, `order_limit > 0`, allowed statuses, and exact snapshot arithmetic. Keep order snapshots when catalog rows are deactivated; do not cascade catalog deletion into orders.

- [ ] **Step 4: Build the schema and run its static tests**

Run:

```powershell
dotnet build examples\bakery\sql\database.sqlproj --output dist\examples\bakery\sql
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: both commands PASS with no SQL warnings.

- [ ] **Step 5: Commit the schema**

```powershell
git add examples/bakery/sql/database.sqlproj examples/bakery/sql/schema.sql examples/bakery/tests/sql-contract.test.ts
git commit -m "feat: add bakery database schema" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Implement Customer SQL Procedures and DAB Permissions

**Files:**
- Create: `examples/bakery/sql/customer-procedures.sql`
- Create: `examples/bakery/sql/grants.sql`
- Create: `examples/bakery/dab-config.json`
- Modify: `examples/bakery/tests/sql-contract.test.ts`

- [ ] **Step 1: Add failing customer-procedure and permission tests**

Require exact public procedures:

```ts
const customer = [
  'BakeryCreateSession',
  'BakeryGetSession',
  'BakeryDeleteSession',
  'BakeryReadiness',
  'BakeryCatalog',
  'BakeryPickupSlots',
  'BakeryQuote',
  'BakeryPlaceOrder',
];
for (const name of customer) {
  assert.match(procedures, new RegExp(`CREATE PROCEDURE dbo\\.${name}\\b`, 'i'));
  assert.match(grants, new RegExp(`GRANT EXECUTE ON dbo\\.${name} TO \\[\\$\\(ApplicationUser\\)\\]`, 'i'));
}
assert.doesNotMatch(grants, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|CONTROL)|db_owner|db_datareader|db_datawriter/i);
```

Parse DAB JSON and assert GraphQL/MCP are disabled, `set-session-context` is false, every entity is a stored procedure, customer entities grant only `BakeryCustomer`, and no generic table entity exists.

- [ ] **Step 2: Run and verify missing procedures fail**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: FAIL because customer procedure, grant, and DAB files are absent.

- [ ] **Step 3: Implement session, catalog, slot, and quote procedures**

Use `SET XACT_ABORT ON`, database UTC time, bounded expired-session cleanup (`DELETE TOP (32)`), and `UPDLOCK, HOLDLOCK` when a live session is required. Accept basket lines as JSON and validate them with `OPENJSON` into table variables:

```sql
DECLARE @lines TABLE (
    line_no int NOT NULL PRIMARY KEY,
    product_id uniqueidentifier NOT NULL,
    quantity tinyint NOT NULL,
    option_ids nvarchar(max) NOT NULL
);
INSERT @lines(line_no, product_id, quantity, option_ids)
SELECT CONVERT(int, [key]), product_id, quantity, option_ids
FROM OPENJSON(@basket)
WITH (
    product_id uniqueidentifier '$.productId',
    quantity int '$.quantity',
    option_ids nvarchar(max) '$.optionIds' AS JSON
);
IF (SELECT COUNT(*) FROM @lines) NOT BETWEEN 1 AND 20
   OR EXISTS (SELECT 1 FROM @lines WHERE quantity NOT BETWEEN 1 AND 20)
    THROW 51001, 'Invalid basket boundaries.', 1;
```

Return one typed outcome row from quote:

```sql
SELECT @outcome AS outcome,
       CONVERT(varchar(32), @total) AS total,
       @line_no AS affected_line,
       @message AS message;
```

Outcomes are `ok`, `expired`, `invalid`, and `unavailable`.

- [ ] **Step 4: Implement atomic placement**

`dbo.BakeryPlaceOrder` accepts `@token_hash`, `@idempotency_key`, `@pickup_slot_id`, normalized guest fields, `@quoted_total decimal(12,2)`, and `@basket nvarchar(max)`.

Inside one transaction:

1. Lock the visitor session.
2. Hash the normalized request with `HASHBYTES('SHA2_256', CONCAT(@pickup_slot_id, N'|', @guest_name, N'|', @guest_email, N'|', @guest_phone, N'|', @basket))`.
3. Return the existing confirmation for the same key and hash.
4. Return `idempotency_conflict` for the same key and another hash.
5. Lock the slot row with `UPDLOCK, HOLDLOCK`.
6. Check active state, cutoff (`@now >= cutoff_at` is closed), and non-canceled count.
7. Parse and validate basket/options.
8. Recalculate total.
9. Return `price_changed` with the authoritative total when it differs.
10. Generate a 10-character Crockford Base32 confirmation code from cryptographic randomness, retrying on unique collision.
11. Insert order, item snapshots, and option snapshots.
12. Commit and return `ok`, confirmation, pickup time, and total.

Use this result shape for every branch:

```sql
SELECT @outcome AS outcome,
       @confirmation_code AS confirmation_code,
       @pickup_starts_at AS pickup_starts_at,
       CONVERT(varchar(32), @authoritative_total) AS total,
       @affected_line AS affected_line,
       @message AS message;
```

- [ ] **Step 5: Add role-scoped DAB entities and grants**

Use DAB host provider `AzureAD` in the source artifact, REST POST only, and:

```json
"permissions": [{ "role": "BakeryCustomer", "actions": ["execute"] }]
```

Grant `EXECUTE` and object-scoped `VIEW DEFINITION` only to `[$(ApplicationUser)]`.

- [ ] **Step 6: Build and test SQL contracts**

Run:

```powershell
dotnet build examples\bakery\sql\database.sqlproj --output dist\examples\bakery\sql
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit customer SQL**

```powershell
git add examples/bakery/sql/customer-procedures.sql examples/bakery/sql/grants.sql examples/bakery/dab-config.json examples/bakery/tests/sql-contract.test.ts
git commit -m "feat: add bakery customer ordering procedures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Implement Staff SQL Procedures and Transition Rules

**Files:**
- Create: `examples/bakery/sql/staff-procedures.sql`
- Modify: `examples/bakery/sql/grants.sql`
- Modify: `examples/bakery/dab-config.json`
- Modify: `examples/bakery/tests/sql-contract.test.ts`

- [ ] **Step 1: Add failing staff-procedure tests**

Require:

```ts
const staff = [
  'BakeryStaffCatalog',
  'BakeryStaffSaveProduct',
  'BakeryStaffSaveOption',
  'BakeryStaffPickupSlots',
  'BakeryStaffSavePickupSlot',
  'BakeryStaffOrders',
  'BakeryStaffTransitionOrder',
  'BakeryStaffMarkPaid',
];
```

Assert each DAB entity grants only `BakeryStaff` and each public procedure has execute/view-definition grants.

- [ ] **Step 2: Run and verify staff procedures are absent**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: FAIL on the first missing staff procedure.

- [ ] **Step 3: Implement catalog and pickup-slot procedures**

Use explicit create/update behavior:

- `@id IS NULL` creates with `NEWID()`.
- A non-null unknown ID returns `not_found`.
- Product/option names are trimmed and length checked.
- Deactivation is allowed; hard deletion is not exposed.
- Slot updates reject `starts_at >= ends_at`, `cutoff_at > starts_at`, and an order limit lower than the current non-canceled count.
- Stale `row_version` returns `conflict`.

Every mutation returns:

```sql
SELECT @outcome AS outcome, @id AS id, @message AS message;
```

- [ ] **Step 4: Implement queue, lifecycle, and payment procedures**

`BakeryStaffOrders` returns orders grouped/sorted by pickup start and creation time, including guest details and item/option snapshots.

`BakeryStaffTransitionOrder` enforces:

```sql
IF NOT (
    (@current = 'New' AND @next IN ('Confirmed', 'Canceled')) OR
    (@current = 'Confirmed' AND @next IN ('Ready', 'Canceled')) OR
    (@current = 'Ready' AND @next IN ('PickedUp', 'Canceled'))
) SET @outcome = N'conflict';
IF @next = 'PickedUp' AND @payment_status <> 'Paid'
    SET @outcome = N'payment_required';
```

`BakeryStaffMarkPaid` allows only non-canceled, non-paid orders and returns `conflict` for stale or terminal state. Both procedures lock the order row with `UPDLOCK, HOLDLOCK`.

- [ ] **Step 5: Build and run SQL contract tests**

Run:

```powershell
dotnet build examples\bakery\sql\database.sqlproj --output dist\examples\bakery\sql
npx tsc
node --test dist/examples/bakery/tests/sql-contract.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit staff SQL**

```powershell
git add examples/bakery/sql/staff-procedures.sql examples/bakery/sql/grants.sql examples/bakery/dab-config.json examples/bakery/tests/sql-contract.test.ts
git commit -m "feat: add bakery staff procedures" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Wire Bakery Routes to SQL Procedures

**Files:**
- Create: `examples/bakery/application.ts`
- Create: `examples/bakery/tests/composition.test.ts`

- [ ] **Step 1: Write failing route-composition tests**

Define the expected route contract:

```ts
const routes = [
  ['GET', '/catalog'],
  ['GET', '/pickup-slots'],
  ['POST', '/quote'],
  ['POST', '/orders'],
  ['GET', '/staff/catalog'],
  ['PUT', '/staff/products'],
  ['PUT', '/staff/options'],
  ['GET', '/staff/pickup-slots'],
  ['PUT', '/staff/pickup-slots'],
  ['GET', '/staff/orders'],
  ['POST', '/staff/orders/:id/status'],
  ['POST', '/staff/orders/:id/payment'],
] as const;
```

Use an `ApplicationAdapter` spy. Assert customer calls include the server-resolved `token_hash` and role `BakeryCustomer`; staff calls first invoke `services.staff`, never include caller identity fields, and use `BakeryStaff`.

Test outcome mapping:

- `price_changed`, `slot_full`, `cutoff`, `unavailable`, `idempotency_conflict`, `conflict`, and `payment_required` -> HTTP 409
- `expired` -> 401
- `invalid` -> 400
- malformed DAB envelopes -> 502
- unexpected procedure failures -> 503/500 through the common error handler, without raw details

- [ ] **Step 2: Run and verify the application definition is absent**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/composition.test.js
```

Expected: TypeScript compilation fails because `application.ts` is absent.

- [ ] **Step 3: Implement typed result parsing and role guards**

Use helpers:

```ts
async function customerExecute(
  services: ApplicationServices,
  request: FastifyRequest,
  procedure: string,
  parameters: ProcedureParameters = {},
) {
  const tokenHash = await services.subject(request);
  return services.execute(procedure, { ...parameters, token_hash: tokenHash }, 'BakeryCustomer');
}

async function staffExecute(
  services: ApplicationServices,
  request: FastifyRequest,
  procedure: string,
  parameters: ProcedureParameters = {},
) {
  if (!services.staff) throw new ApplicationError(500, 'Staff identity service unavailable');
  await services.staff(request);
  return services.execute(procedure, parameters, 'BakeryStaff');
}
```

For placement, send only normalized contract values:

```ts
const body = placeOrderSchema.safeParse(request.body);
if (!body.success) throw new ApplicationError(400, 'Check guest, pickup, and basket fields');
const result = await customerExecute(services, request, 'PlaceOrder', {
  idempotency_key: body.data.idempotencyKey,
  pickup_slot_id: body.data.pickupSlotId,
  quoted_total: body.data.quotedTotal,
  guest_name: body.data.guest.name,
  guest_email: body.data.guest.email,
  guest_phone: body.data.guest.phone,
  basket: JSON.stringify(body.data.lines),
});
```

Return 201 only for a newly created order and 200 for an identical idempotent replay.

- [ ] **Step 4: Declare exact selected inputs**

Export `application` with:

```ts
name: 'bakery',
access: 'hybrid',
capabilities: ['data', 'visitor-sessions', 'staff-sessions'],
profiles: ['local-simulation'],
inputs: {
  browser: 'web/app.ts',
  html: 'web/index.html',
  css: 'web/app.css',
  sqlProject: 'sql/database.sqlproj',
  sqlFiles: ['sql/schema.sql', 'sql/customer-procedures.sql', 'sql/staff-procedures.sql'],
  grants: 'sql/grants.sql',
  dab: 'dab-config.json',
},
```

List every DAB entity in `procedures` and map session procedure names in `sessions`.

- [ ] **Step 5: Run composition and Todo regression tests**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/composition.test.js dist/examples/todo/tests/composition.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit route composition**

```powershell
git add examples/bakery/application.ts examples/bakery/tests/composition.test.ts
git commit -m "feat: compose bakery application routes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 9: Implement the Typed Browser Client

**Files:**
- Create: `examples/bakery/web/client.ts`
- Create: `examples/bakery/tests/client.test.ts`

- [ ] **Step 1: Write failing client tests**

Verify same-origin credentials for customer calls, bearer authorization only for staff calls, fresh UUID idempotency keys, strict response parsing, and surfaced JSON errors:

```ts
const client = new BakeryClient(fetcher, () => '11111111-1111-4111-8111-111111111111');
await client.startVisitor();
await client.catalog();
await client.pickupSlots();
await client.quote(lines);
await client.placeOrder({ guest, pickupSlotId, quotedTotal: '18.50', lines });
client.setStaffToken('local-staff-token');
await client.staffOrders();
assert.equal(new Headers(calls.at(-1)?.headers).get('authorization'), 'Bearer local-staff-token');
```

Assert malformed success payloads reject with `Invalid application response`; non-JSON errors reject with `Application did not return JSON`; 401 and 403 preserve status in `BakeryApiError`.

- [ ] **Step 2: Run and verify the client is absent**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/client.test.js
```

Expected: TypeScript compilation fails because `web/client.ts` is absent.

- [ ] **Step 3: Implement the client**

Expose methods:

```ts
startVisitor(): Promise<VisitorSession>
catalog(): Promise<Catalog>
pickupSlots(): Promise<PickupSlot[]>
quote(lines: OrderLineInput[]): Promise<Quote>
placeOrder(input: Omit<PlaceOrderInput, 'idempotencyKey'>): Promise<OrderConfirmation>
staffConfig(): Promise<StaffConfig>
startStaff(user: string): Promise<void>
endStaff(): Promise<void>
staffCatalog(): Promise<StaffCatalog>
saveProduct(input: SaveProduct): Promise<MutationResult>
saveOption(input: SaveOption): Promise<MutationResult>
staffPickupSlots(): Promise<PickupSlot[]>
savePickupSlot(input: SavePickupSlot): Promise<MutationResult>
staffOrders(): Promise<StaffOrder[]>
transitionOrder(id: string, status: OrderStatus): Promise<StaffOrder>
markPaid(id: string): Promise<StaffOrder>
```

Use `credentials: 'same-origin'` on all calls and add bearer authorization only under `/staff`.

- [ ] **Step 4: Run client tests**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/client.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the browser client**

```powershell
git add examples/bakery/web/client.ts examples/bakery/tests/client.test.ts
git commit -m "feat: add bakery browser client" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 10: Build the Customer and Staff Browser Experience

**Files:**
- Create: `examples/bakery/web/index.html`
- Create: `examples/bakery/web/app.css`
- Create: `examples/bakery/web/app.ts`
- Create: `examples/bakery/tests/web.test.ts`

- [ ] **Step 1: Write failing semantic UI tests**

Require:

```ts
assert.match(html, /<main\b/);
assert.match(html, /id="customer-catalog"/);
assert.match(html, /id="basket"/);
assert.match(html, /id="checkout-form"/);
assert.match(html, /id="order-confirmation"/);
assert.match(html, /id="staff-orders"/);
assert.match(html, /id="staff-catalog"/);
assert.match(html, /id="staff-slots"/);
assert.match(html, /aria-live="polite"/);
assert.match(html, /<label\b[^>]*for=/);
assert.doesNotMatch(html, /onclick=/i);
assert.match(css, /:focus-visible/);
assert.match(css, /@media\s*\(max-width:/);
```

- [ ] **Step 2: Run and verify browser files are absent**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/web.test.js
```

Expected: FAIL with `ENOENT` for `index.html`.

- [ ] **Step 3: Create semantic HTML and accessible styles**

Use one page with:

- Customer header and basket summary
- Product cards rendered into `customer-catalog`
- Checkout form with labeled name/email/phone/pickup controls
- Confirmation region
- Staff sign-in panel
- Staff tabs implemented as buttons with `aria-controls` and `aria-selected`
- Order queue, catalog editor, and slot editor sections
- Shared `role="status" aria-live="polite"` and `role="alert"` regions

Use CSS custom properties, visible `:focus-visible`, a single-column layout under 720px, minimum 44px control targets, non-color status text, and no external fonts/assets.

- [ ] **Step 4: Implement browser controllers**

In `web/app.ts`:

- Start/resume the visitor session.
- Render only active/available catalog entries.
- Keep a local basket keyed by product/options.
- Requote after every basket change and before enabling checkout.
- Generate a new idempotency key only for a new submit intent; retain it across retry after a transport failure.
- On `price_changed`, replace the quote and require a second explicit submit.
- On `slot_full` or `cutoff`, refresh slots and preserve basket/contact fields.
- Render confirmation and clear basket only after success.
- Sign in Alice/Bob through `/staff/session`.
- Hide staff panels after 401/403.
- Refresh order queue after catalog/slot/order/payment mutations.
- Render only valid next status buttons.
- Move focus to the first invalid field or the confirmation heading after submit.
- Set all user text with `textContent`, never `innerHTML`.

- [ ] **Step 5: Run browser and client tests**

Run:

```powershell
npx tsc
node --test dist/examples/bakery/tests/web.test.js dist/examples/bakery/tests/client.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit the browser**

```powershell
git add examples/bakery/web/index.html examples/bakery/web/app.css examples/bakery/web/app.ts examples/bakery/tests/web.test.ts
git commit -m "feat: add bakery customer and staff UI" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 11: Add Real Local Acceptance and Regression Coverage

**Files:**
- Create: `examples/bakery/acceptance.mjs`
- Modify: `src/local-cli.ts`
- Modify: `tests/selected-local.test.ts`

- [ ] **Step 1: Wire a failing selected acceptance command**

Add `selected-test` dispatch for the bakery manifest:

```ts
if (manifest.name === 'bakery') {
  await run(process.execPath, [join(home, 'examples', 'bakery', 'acceptance.mjs'), directory]);
} else if (manifest.name === 'todo') {
  await run(process.execPath, [join(home, 'examples', 'todo', 'demo', 'smoke.mjs'), directory]);
} else {
  throw new Error(`Selected application ${manifest.name} has no approved acceptance suite`);
}
```

Update the CLI test to assert the command remains documented and rejects a nonexistent artifact before starting resources.

- [ ] **Step 2: Run and verify the bakery suite is missing**

Run:

```powershell
npx tsc
node --test dist/tests/selected-local.test.js
```

Expected: FAIL on the bakery acceptance fixture or explicit missing-suite assertion.

- [ ] **Step 3: Implement deterministic acceptance setup**

In `acceptance.mjs`:

- Validate the artifact with `checkSelectedApplication`.
- Require manifest name `bakery`.
- Create a visitor session and Alice/Bob staff sessions through the gateway.
- Insert no rows directly for normal workflow setup; use staff routes.
- Track created product, option, slot, session hashes, and order IDs for cleanup.
- Use unique synthetic names prefixed with a random run ID.

- [ ] **Step 4: Implement required risk scenarios**

Assert:

1. Alice can create catalog/options/slot; Bob and anonymous callers receive 403/401.
2. Forged `x-ms-api-role` and `x-ms-client-principal` headers receive 403.
3. Customer cannot call any `/staff` route.
4. A normal order returns confirmation, current total, and pickup time.
5. Repeating the same idempotency key/body returns the same order; a changed body returns 409.
6. Price and availability changes between quote/place return 409 and create no order.
7. Twenty lines at quantity 20 pass when valid; line 21 and quantity 21 return 400.
8. Two concurrent orders for the last slot produce one success and one `slot_full`.
9. Cutoff succeeds one millisecond before, rejects exactly at, and rejects after; advance only the synthetic slot timestamps with admin SQL.
10. Catalog changes do not alter order snapshots.
11. Every allowed lifecycle/payment transition passes; every disallowed transition returns 409.
12. `PickedUp` while unpaid returns `payment_required`.
13. Gateway restart preserves SQL data; resume and re-read the order queue.
14. The application login has no table CRUD, schema control, or internal-helper execute permission.

- [ ] **Step 5: Guarantee scoped cleanup**

Use `finally` to delete only records bearing the run ID, plus their visitor sessions, through an admin query. Verify zero matching records remain. If both acceptance and cleanup fail, throw `AggregateError` containing both failures.

- [ ] **Step 6: Run compiled unit tests**

Run:

```powershell
npx tsc
node --test dist/tests/hybrid-app.test.js dist/tests/selected-local.test.js dist/examples/bakery/tests/contract.test.js dist/examples/bakery/tests/composition.test.js dist/examples/bakery/tests/client.test.js dist/examples/bakery/tests/sql-contract.test.js dist/examples/bakery/tests/web.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit acceptance**

```powershell
git add examples/bakery/acceptance.mjs src/local-cli.ts tests/selected-local.test.ts
git commit -m "test: add bakery local acceptance" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 12: Document the Exact Local Journey

**Files:**
- Create: `examples/bakery/README.md`
- Modify: `docs/guides/build-your-app.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Write the bakery README**

Document:

```powershell
npm ci
npm run build
npm run local -- workspace-plan
$basePort = Read-Host 'Enter the approved free base port printed by workspace-plan'
npm run local -- workspace-init $basePort
npm run app:build -- bakery local-simulation
$artifact = Read-Host 'Paste the absolute artifact directory printed by app:build'
npm run local -- selected-app $artifact
npm run local -- selected-test $artifact
npm run local -- selected-stop bakery
```

Explain that:

- Alice is simulated staff and Bob proves denial.
- Guest details must be synthetic.
- The app is local-only and has no deployment profile.
- `selected-serve` resumes verified services and persisted data.
- Acceptance creates and removes only run-scoped synthetic data.
- Browser checks still include narrow/mobile layout, keyboard-only ordering, visible focus, validation focus movement, and understandable conflict messages.

- [ ] **Step 2: Link the bakery app without changing the default foundation**

Add the bakery as an explicitly selected local application in `docs/guides/build-your-app.md` and `docs/README.md`. State that it demonstrates the hybrid guest/staff boundary and is not copied into new applications automatically.

- [ ] **Step 3: Commit documentation**

```powershell
git add examples/bakery/README.md docs/guides/build-your-app.md docs/README.md
git commit -m "docs: add bakery local walkthrough" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 13: Build, Run, Find Bugs, and Close the Completion Gate

**Files:**
- Modify only files implicated by reproduced defects
- Add regression tests beside the failing layer

- [ ] **Step 1: Run focused static and unit validation**

Run:

```powershell
npm run build
npm run typecheck
dotnet build examples\bakery\sql\database.sqlproj --output dist\examples\bakery\sql
node --test dist/tests/hybrid-app.test.js dist/tests/application-build.test.js dist/tests/selected-local.test.js dist/examples/bakery/tests/contract.test.js dist/examples/bakery/tests/composition.test.js dist/examples/bakery/tests/client.test.js dist/examples/bakery/tests/sql-contract.test.js dist/examples/bakery/tests/web.test.js
node scripts\test-examples.mjs
```

Expected: every command exits 0. If a command fails, capture the exact command and output, add a focused regression, fix the root cause, rerun the focused test, then rerun this step.

- [ ] **Step 2: Build and validate the selected artifact**

Run in the explicitly initialized isolated workspace:

```powershell
npm run app:build -- bakery local-simulation
$artifact = Read-Host 'Paste the absolute artifact directory printed by app:build'
npm run app:check -- --selected $artifact local-simulation
```

Expected: artifact output reports `bakery`, `hybrid`, `local-simulation`, exact source/artifact checksums, and the declared route contract.

- [ ] **Step 3: Start and verify the real local stack**

After explicit SQL EULA/download/schema/startup approval:

```powershell
npm run local -- selected-app $artifact
```

Verify `/health/live`, `/health/ready`, and `/application/manifest` return 200 from the printed origin before treating the app as running.

- [ ] **Step 4: Run automated real-stack acceptance**

Run:

```powershell
npm run local -- selected-test $artifact
```

Expected final line:

```text
SELECTED BAKERY SQL/GATEWAY ACCEPTANCE PASSED
```

Do not weaken checks to obtain this line. Reproduce every defect with a regression and repeat Steps 1 through 4 after a cross-layer fix.

- [ ] **Step 5: Perform browser acceptance**

At the printed origin:

1. Use a 375px-wide viewport and keyboard only to browse, customize, select a slot, enter synthetic guest details, and place an order.
2. Confirm visible focus, associated validation errors, and confirmation focus.
3. Reload and verify catalog/slot persistence.
4. Sign in as Bob and verify staff denial.
5. Sign in as Alice and verify queue, catalog, slot, payment, and lifecycle actions.
6. Restart with `selected-serve` and verify the order remains.
7. Trigger price-change, unavailable-item, slot-full, and cutoff conflicts and verify basket/contact preservation and actionable messages.

Record exact steps and screenshots or response evidence for any defect before fixing it.

- [ ] **Step 6: Run the repository completion suite**

Run:

```powershell
npm test
```

Expected: PASS, including build, TypeScript, clean application checks, root tests, and all example tests.

- [ ] **Step 7: Inspect the final diff and known-issue list**

Run:

```powershell
git --no-pager status --short
git --no-pager diff --check
git --no-pager log -13 --oneline
```

Confirm no generated artifact, credential, visitor token, synthetic PII, workspace state, or unrelated dirty file is staged. Confirm there is no unresolved critical or high-impact defect. Document any accepted lower-impact issue in `examples/bakery/README.md` with reproduction, impact, and rationale.

- [ ] **Step 8: Commit any final regression-only fixes**

For each acceptance defect, stage its named regression test and named root-cause file immediately after that focused test and the containing suite pass, then run:

```powershell
git commit -m "fix: resolve bakery acceptance regression" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Do not create this commit when acceptance required no change, and do not stage unrelated dirty files.

## Final Evidence Checklist

- [ ] Selected artifact source and output checksums pass.
- [ ] SQL project builds with warnings treated as errors.
- [ ] Customer and staff DAB procedure sets are role-separated.
- [ ] Alice is authorized; Bob, anonymous staff requests, customer sessions, and forged headers are denied.
- [ ] Price, availability, basket, cutoff, capacity, idempotency, lifecycle, payment, and snapshot scenarios pass.
- [ ] Concurrent final-slot test yields exactly one order.
- [ ] Data survives restart.
- [ ] Browser mobile/keyboard/error flows pass.
- [ ] Acceptance cleanup removes only its synthetic run.
- [ ] Full `npm test` passes.
- [ ] No deployment command ran.
