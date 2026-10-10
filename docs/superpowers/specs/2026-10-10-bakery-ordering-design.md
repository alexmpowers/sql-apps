# Bakery Online Ordering Design

## Summary

Build a small, local-first bakery ordering application with a purpose-built hybrid gateway. Customers place scheduled pickup orders through opaque visitor sessions without signing in. Bakery staff use the repository's simulated local identity flow and a dedicated `BakeryStaff` application role to manage the catalog, pickup capacity, order lifecycle, and pay-at-pickup status.

The first version is complete only after its browser workflows, SQL rules, authorization boundaries, concurrency behavior, and persistence have been verified against the real local stack. Deployment is out of scope.

## Goals

- Let a customer browse currently orderable bakery products.
- Let a customer choose predefined options such as size or flavor.
- Let a customer choose an eligible pickup slot and place an order using their name, phone number, and email address.
- Show an immediate confirmation containing a non-sequential public confirmation code, pickup time, authoritative total, and pay-at-pickup instructions.
- Let staff create and edit products, options, prices, availability, pickup slots, and capacity.
- Let staff manage orders through the approved lifecycle and record payment.
- Prevent incorrect totals, cutoff violations, slot overbooking, duplicate submissions, unauthorized staff operations, and historical-order mutation.
- Find and fix remaining process or implementation bugs through repeatable regression tests and end-to-end acceptance.

## Non-goals

- Customer accounts, sign-in, saved addresses, or order history
- Customer self-service changes or cancellation
- Delivery
- Online payment or refunds
- Outbound email or SMS
- Free-form custom orders, cake inscriptions, or uploads
- Ingredient-level inventory
- Files or background jobs
- Cloud deployment or production-readiness certification

Customers contact the bakery if an order needs to change. Staff perform any permitted cancellation or status update.

## Architecture

Use an application-specific hybrid gateway:

- A public customer browser experience supports catalog browsing, basket management, checkout, and confirmation through an opaque, server-issued visitor session.
- A protected staff browser experience supports the order queue, catalog management, and pickup-slot management after the gateway verifies a local simulated identity with the `BakeryStaff` role.
- Data API Builder listens only on an internal loopback origin and exposes only approved stored procedures. The gateway selects the customer or staff DAB role after resolving the server-owned visitor session or verified staff identity; caller-submitted identity and role headers are rejected.
- Azure SQL Database is authoritative for prices, availability, slot cutoff and capacity, order totals, idempotency, and lifecycle transitions.

The hybrid gateway is a deliberate extension, not the existing `role-based-data` profile. That profile requires every user to hold one configured application role and therefore cannot serve both anonymous guests and separately authorized staff. The implementation reuses two existing repository patterns: the selected application's opaque visitor-session boundary for customer requests and the gateway's verified-role boundary for staff requests.

The frontend may calculate provisional totals and show provisional availability for responsive feedback. The order-placement procedure recalculates and revalidates everything in one transaction. Customer operations cannot invoke staff procedures. Neither DAB role receives direct table-write access.

This approach is preferred over browser-managed table CRUD because concurrency and authorization rules remain enforceable when a client is stale or hostile. The custom gateway is justified by the otherwise incompatible public-customer and protected-staff access requirements; it remains narrow and delegates durable business rules to SQL.

## Components and Responsibilities

### Customer experience

The customer experience has four steps:

1. **Browse:** show active, available products with current descriptions and prices.
2. **Customize:** choose active predefined option values and a quantity.
3. **Checkout:** choose an eligible pickup slot and provide guest contact details.
4. **Confirm:** show the confirmation code, pickup time, authoritative total, and pay-at-pickup note.

The basket remains visible with a provisional total. Checkout states clearly that price and availability are rechecked when the order is placed.

On first use, the gateway issues a 256-bit opaque visitor-session token in an HttpOnly, SameSite=Strict, origin-scoped cookie with a 60-minute lifetime. Public HTTPS would also require the Secure flag; the local loopback cookie remains non-Secure so local HTTP works. The original token is never stored in SQL; SQL stores its SHA-256 hash. The session establishes request continuity and CSRF protections but is not a customer account and grants no order-list or order-retrieval capability.

### Staff experience

The staff experience opens on an order queue grouped by pickup date and time. Each order shows its confirmation code, items, total, lifecycle state, and payment state. Valid next actions are available directly from the queue.

Primary sections are:

- **Orders:** filter and manage the pickup queue.
- **Catalog:** create and edit products, option groups and values, prices, and availability.
- **Pickup slots:** create and edit time windows, order limits, cutoff times, and availability.

### Data API Builder

Data API Builder exposes narrowly scoped operations:

- Customer reads for the orderable catalog and eligible pickup slots
- A customer quote operation
- An atomic customer order-placement operation
- Staff catalog, pickup-slot, queue, lifecycle, and payment operations

Generic table writes and an unrestricted proxy are not exposed.

Data API Builder is not reachable directly from the browser. Customer and staff procedure sets use distinct DAB roles selected by the gateway. Submitted `x-ms-client-principal`, DAB-role, or equivalent identity headers are rejected at the public gateway boundary.

### SQL domain

SQL owns durable records, integrity constraints, permissions, transaction boundaries, and authoritative business rules. Stored procedures return explicit domain outcomes rather than leaking database implementation details.

## Data Model

### Products

A product has a name, description, base price, active flag, and available flag. Inactive records are retained when referenced by historical orders.

### Product options

An option value belongs to a product and an option group, such as `Size: Large` or `Flavor: Chocolate`. It has a price adjustment and active flag. A basket line cannot select more than one value from the same option group.

### Pickup slots

A pickup slot has a start time, end time, maximum order count, cutoff time, and active flag. Capacity is measured in non-canceled orders, not item quantity. Canceling an eligible order releases one order position.

### Orders

An order has:

- An internal identifier
- A unique 10-character Crockford Base32 confirmation code generated from cryptographically secure randomness
- An idempotency key scoped to order placement
- Normalized guest name, phone number, and email address
- A pickup-slot reference and pickup-time snapshot
- An authoritative total
- Lifecycle and payment states
- Created and updated timestamps

The public confirmation code is unique and is not an authorization mechanism for reopening an order.

### Order items

Each order item stores the selected product and option identifiers for traceability plus immutable snapshots of displayed product name, selected option labels, base price, adjustments, quantity, and line total. Later catalog edits do not alter historical order display or totals.

Money uses fixed-precision decimal types. Totals are computed from current server-side prices when placement commits, never from client-provided money values.

## Validation Boundaries

- A basket contains 1 through 20 distinct lines.
- Each line quantity is an integer from 1 through 20.
- Every selected product and option must be active, available, and mutually compatible at commit time.
- An option group appears no more than once on a line.
- Guest name is trimmed, required, and 1 through 100 Unicode characters.
- Guest email is trimmed, lowercased for storage, required, syntactically validated, and no more than 254 characters.
- Guest phone is trimmed, required, normalized to an optional leading `+` followed by 7 through 15 digits, and stored in that canonical form.
- Browser and gateway validation use the same limits as SQL parameters and schema columns. Overlong or malformed input is rejected explicitly rather than truncated.
- Pickup eligibility uses database time as the authority.

## Order Placement

The customer submits guest details, pickup-slot ID, product and option IDs, quantities, the provisional quoted total, and a unique idempotency key.

In one SQL transaction, the placement operation:

1. Validates and normalizes request shape and contact data.
2. Rejects invalid quantities, excessive line counts, duplicate option groups, or incompatible options.
3. Acquires a lock that serializes capacity decisions for the selected pickup slot.
4. Verifies the slot is active, not past cutoff, and below its non-canceled order limit.
5. Verifies every product and option is currently active, available, and compatible.
6. Recalculates all line totals and the order total from current SQL prices.
7. Compares the authoritative total with the submitted quote.
8. Creates the order and immutable order-item snapshots.
9. Commits and returns the confirmation code, pickup time, and authoritative total.

If the same idempotency key is retried with the same normalized request, the original successful result is returned. Reusing a key with a materially different request is rejected as a conflict.

Any failure rolls back the transaction. No partial order or capacity reservation remains.

## Expected Failure Behavior

- **Price changed:** create no order and return the current quote for customer review.
- **Item or option unavailable:** create no order and identify the affected basket line without exposing internals.
- **Slot full or cutoff passed:** create no order and return the currently eligible pickup slots.
- **Duplicate submission:** return the original result for an identical idempotent retry; create no second order.
- **Invalid or stale staff transition:** return a conflict containing the current state.
- **Validation failure:** associate a safe, actionable message with the relevant field or line.
- **Unexpected failure:** show a retry-safe message and correlation ID. Log structured diagnostic details locally.

Errors are never converted into success-shaped empty results. Logs redact phone numbers and email addresses and do not record raw order payloads.

## Lifecycle and Payment Rules

The normal order lifecycle is:

`New -> Confirmed -> Ready -> Picked up`

`New`, `Confirmed`, or `Ready` may transition to `Canceled`. `Picked up` and `Canceled` are terminal.

Payment begins as `Unpaid` and may transition to `Paid`. An order cannot become `Picked up` while unpaid. A canceled order cannot be marked paid. The first version does not model refunds or reverse a paid state.

All transitions are enforced in SQL using the current persisted state. Concurrent or stale updates return a conflict rather than silently succeeding.

## Authorization and Privacy

- The customer experience requires an opaque visitor session but no sign-in or customer account.
- The local simulated identity flow presents Development Alice with the `BakeryStaff` role and Development Bob without it. This proves local routing and denial behavior, not production identity.
- Customer operations can read only the public orderable catalog and eligible pickup slots and can quote or place an order through the customer DAB role.
- Customer operations cannot list orders, retrieve guest contact data, manage catalog data, manage slots, or invoke staff transitions.
- Staff endpoints require a gateway-verified identity with the `BakeryStaff` role. Forged caller headers, customer sessions, anonymous requests, and Development Bob are denied.
- Staff operations use a distinct staff DAB role and can manage the agreed bakery domain through procedures but do not receive schema-owner or unrestricted table permissions.
- Guest contact details appear only in the staff experience and the immediate confirmation response.
- Confirmation codes do not grant retrieval access.
- Synthetic guest data is used for development and acceptance.

## Accessibility and Responsive Behavior

The customer and staff flows are keyboard-complete and use semantic controls, labels, and error associations. Focus is visible. Statuses do not depend on color alone. Text and controls meet the repository's contrast expectations. Layouts remain usable from narrow phone screens through desktop widths.

## Verification Strategy

### Static and contract checks

Run the smallest repository commands that cover:

- Type checking and build output
- SQL project build
- Selected-application contract validation
- Existing repository tests affected by the implementation

The implementation plan must identify exact commands from the current repository rather than inventing parallel tooling.

### SQL integration tests

Run against the real local Azure SQL Database container. Cover:

- Procedure inputs, outputs, permissions, and transaction rollback
- Visitor-session hashing, expiry, and customer/staff DAB-role separation
- Price and order-total calculations
- Product-option compatibility
- Slot cutoff and capacity behavior
- Idempotency
- Order and payment transition matrices
- Immutable historical snapshots
- Contact and basket boundaries
- Concurrent order placement

### Browser workflow tests

Exercise rendered customer and staff experiences through the hybrid gateway and its internal Data API Builder boundary:

- Browse, customize, quote, place, confirm, and reload
- Staff queue display and valid next actions
- Catalog and pickup-slot management
- Validation and expected conflict messages
- Customer/staff authorization separation
- Forged identity/role-header rejection and Development Bob's denial
- Keyboard navigation and responsive layouts

Browser tests do not bypass the application by writing directly to SQL.

### Manual local acceptance

Using synthetic data:

1. Create catalog records and a pickup slot as staff.
2. Place a guest order and verify confirmation details.
3. Reload both experiences and verify persistence.
4. Move the order through payment and lifecycle states.
5. Restart the selected local services and verify the order still exists and remains consistent.
6. Verify customer access cannot reach staff data or operations.
7. Verify Development Alice can perform staff actions and Development Bob cannot.
8. Remove acceptance data when the checks finish.

## Required Risk Scenarios

The following scenarios must have repeatable evidence:

- Two simultaneous orders compete for the final slot position; exactly one succeeds.
- Cutoff behavior is correct immediately before, exactly at, and immediately after the cutoff.
- A price change between quote and placement causes review and creates no order.
- An availability change between quote and placement identifies the affected line and creates no order.
- Repeating a successful submission with the same idempotency key creates exactly one order.
- Reusing an idempotency key with different content is rejected.
- A valid basket of 20 lines with 20 units per line is accepted when other rules permit it.
- A 21st line or a quantity of 21 is rejected without partial writes.
- Catalog edits do not change historical product names, options, pickup time, or totals.
- Every allowed and disallowed lifecycle and payment transition is exercised.
- Customer access cannot read the staff queue, guest contact information, or staff mutations.
- Anonymous requests without a visitor session, forged role headers, customer sessions on staff endpoints, and Development Bob are denied.
- Data survives application and service restarts.

## Bug Resolution Process

For each defect:

1. Record the exact failing command or browser steps, expected behavior, actual behavior, and relevant correlation ID.
2. Reduce the issue to the smallest reproducible failing test at the lowest appropriate layer.
3. Fix the root cause without weakening validation or changing unrelated behavior.
4. Run the new regression test, its containing suite, and the repository-required validation.
5. Repeat full customer and staff acceptance after any cross-layer fix.

A discovered bug is not considered resolved based only on code inspection or a narrower proxy check. Its original failure must be reproduced before the fix when feasible and directly verified after the fix.

## Completion Criteria

The local application is complete when:

- All relevant static, schema, contract, integration, browser, and repository checks pass.
- Every required risk scenario passes against the real local stack.
- Customer and staff acceptance flows pass after a clean build and after a service restart.
- No known critical or high-impact defect remains.
- Any accepted lower-impact issue has documented reproduction steps, user impact, and rationale for deferral.
- Synthetic acceptance data and temporary test resources are cleaned up without deleting persistent development state outside the test scope.
- No deployment has been attempted.
