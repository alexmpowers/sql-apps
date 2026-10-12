# Sharing your app

Before moving a local app online, decide **who should use it** and **what information it contains**. A public URL is not a substitute for access control.

## Choose the right path

| You want to... | Current option |
| --- | --- |
| Keep using the app on your computer | Stay local. No cloud deployment is needed. |
| Let people try a public app with synthetic data | Review the [public-demo publishing candidate](../reference/demo-deployment.md). Its proposed guided commands are not yet the default deployment path. |
| Share an authenticated app with the full foundation capabilities | Full Azure commands require Entra setup, paid Functions/storage/Key Vault/private-network infrastructure and a privately connected SQL deployment runner. |
| Share a role-authorized data-only domain app | Use the [role-based-data profile](../reference/role-based-data.md): matching cost review, two-image artifacts, authorized identity/assignment and private SQL deployment. Paid infrastructure and live authorization/browser acceptance are still required. |

Do not put real or sensitive information in the anonymous synthetic-data reference.

## Review costs first

Select the agreed capability/access profile before choosing a cost command. Read [Costs and growth](costs.md). The goal is free-tier-first, but current templates include recurring charges. A cost review is a decision step, not permission to spend or deploy.

For a public-demo cost review after building:

```powershell
npm run azure -- demo-cost azure-demo-cost.example.json
```

The zero-spend example reports known fixed-charge blockers and exits 2. This is expected; it does not create resources. Its output is demo-only, not a price estimate for an authenticated app. Review the authenticated application's actual resources/prices separately; missing estimates are unknown, not zero. See the [cost command reference](../reference/demo-cost.md).

## Prepare an authenticated deployment

If this is the path you need, follow the [deployment reference](../reference/deployment.md). You will review your Azure target, identities, images, networking, schema and costs before creating resources.

If the approved app excludes files/jobs, select `role-based-data` rather than expanding to the full template or changing authorized access to an anonymous demo. Its `identity` command creates the configured human role and `role-based-assign` manages explicitly approved assignments; the foundation profile still creates `Function.Invoke`. Verify token claims and trusted DAB forwarding in the real environment.

Existing-resource discovery must not change the deployment subject. Older matching Azure resources are potential collisions and remain untouched. Keep the new checkout and its artifacts as the source unless reuse is explicitly requested and separately reviewed. Preparation is not permission to create, modify or delete resources.

After an approved deployment, test sign-in, each user's access, saved data, selected capabilities and recovery in that environment. Local tests and template compilation do not prove those cloud behaviors.

For the evolving minimal public-demo path, use [public-demo publishing candidate](../reference/demo-deployment.md). It is a technical reference, not a shortcut around approval, cost and live-acceptance gates.

## Public-demo hosting candidate

For a public synthetic demo, the Static Web Apps candidate looks like one app at **one public URL**. **Static Web Apps Standard hosts the static website** and forwards `/api/*` to **one linked Container App**. That Container App runs the protected Node API and an internal **Data API Builder (DAB)** sidecar; DAB has no public ingress and connects to Azure SQL with managed identity.

This design does **not** use App Service for the website. It also does not use Static Web Apps Database Connections: that feature is retired, so `/data-api` is not part of the design. The browser uses only the Static Web Apps hostname and same-origin `/api/*` routes.

Static Web Apps Standard is **not automatically cheaper**. It adds a resource while Container Apps, ACR, networking and SQL remain. The current Container Apps public-demo path remains the default until a dated, same-basis `hosting-compare` result and the complete live acceptance checklist both pass. A successful comparison reports a candidate; it never changes the default automatically.

The candidate command interface is:

```powershell
npm run azure -- demo-publish azure-demo-publication.json
npm run azure -- demo-publish azure-demo-publication.json --approve <reviewed-id>
npm run azure -- demo-status azure-demo-publication.json
npm run azure -- hosting-compare azure-demo-hosting-comparison.json
```

These commands are the proposed public-demo journey, not permission to spend and not guidance for real data. Keep using the private, advanced [role-based-data](../reference/role-based-data.md) and [full-foundation](../reference/deployment.md) paths for their intended authenticated applications.

## Accounts before publishing

Follow **Build -> Sign in -> Give access -> Publish** and the [authentication and application-access reference](../reference/authentication.md). Product screens use account and access states; local preview test identities are not an onboarding system for real users.

Giving someone access requires a separately approved application-role assignment and the appropriate DAB permissions and SQL grants. Verify the delegated token, role forwarding and any owner restrictions, not just the ability to sign in. Browser role editing, guest invitations and an administration console are not implemented.

Container Apps is the current supported hosting implementation and remains the default. Static Web Apps Standard is the public synthetic-demo candidate described above; App Service is not used for its website. SWA CLI only mocks authentication and is not a prerequisite for real local Entra sign-in.

Changing hosting does not remove private SQL, networking, selected-service costs or identity requirements. Any new publishing path needs its own deployment and rollback plan, cost review, spending approval and explicit authorization before Azure changes.
