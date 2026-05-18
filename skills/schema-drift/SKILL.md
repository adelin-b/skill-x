---
name: schema-drift
description: Detect schemas that drifted across layers — same concept defined twice with diverging fields, defaults, or types in form validators, API contracts, DB models, GraphQL/tRPC/Convex routers, and codegen output. Inventory the stack first, recommend the single source-of-truth pattern that fits it, then propose one concrete refactor with the right tool to enforce it. Use whenever the user says "schema drift", "schemas don't match", "form rejects valid data", "OpenAPI out of sync", "drizzle drift", "prisma out of sync", "DB and API disagree", "validate everywhere", or after a schema-bearing file changes.
sources: []
composed_from: []
compose_rule: ""
last_synced: 1970-01-01T00:00:00Z
upstream_hash: ~
category: drift-detection
triggers:
  - kind: prompt
    value: "schema drift"
  - kind: prompt
    value: "schemas don't match"
  - kind: prompt
    value: "drizzle drift"
  - kind: prompt
    value: "openapi out of sync"
  - kind: file-change
    value: "**/schema.{ts,prisma,sql,graphql,json,yaml}"
---

# schema-drift

A concept lives in multiple places — a `User` is a zod schema in `forms/`, a column set in `db/schema.ts`, a request body in `openapi.yaml`, and a column projection in a SQL view. Drift is when those four no longer agree. This skill finds drift and proposes the single source-of-truth that makes it stop.

## When to trigger

- User says "schema drift", "schemas don't match", "form rejects valid data", "OpenAPI out of sync".
- Stack-level signals: `drizzle-kit check` reports changes, `prisma migrate diff --exit-code` returns 2, `openapi-diff` flags breaking changes, tRPC types fail to compile.
- A schema-bearing file changed (`**/schema.{ts,prisma,sql,graphql,json,yaml}`, anything named `*Schema.ts` or `*Validator.ts`).
- Proactive: before a release that touches forms + API + DB.

## Workflow

### 1. Inventory the stack — zero tokens, fast

Read `package.json` to learn which schema systems are in play. Group deps into layers; each layer points to a detection tool you will invoke later.

| Layer | Signal in package.json | Detection tool |
|-------|------------------------|----------------|
| Form validation | `zod`, `valibot`, `yup`, `react-hook-form`, `formik`, `conform`, `@hookform/resolvers` | `tsc --noEmit` + grep for schema definitions |
| API contract | `openapi-typescript`, `ts-rest`, `@trpc/server`, `oazapfts`, `kubb` | `openapi-diff`, `tsc --noEmit` |
| DB ORM | `drizzle-orm`, `prisma`, `@prisma/client`, `kysely`, `sequelize` | `drizzle-kit check`, `prisma migrate diff --exit-code`, `atlas schema diff` |
| Sync layer | `zod-to-openapi`, `valibot-to-json-schema`, `ts-to-zod`, `openapi-to-zod` | regenerate + `git diff` |
| Cross-layer truth | `convex`, `@apollo/server` + codegen, `@hotchocolate`, `effect/Schema` | none — these *are* the source of truth |

Also scan filesystem for: `*.openapi.{yaml,json}`, `*.graphql`, `*.prisma`, `schema.{sql,ts}`, `convex/_generated/`.

### 2. Extract claims — one IR for every layer

For each schema-bearing artifact, parse it into a uniform claim:

```ts
type SchemaClaim = {
  kind: "zod" | "valibot" | "yup" | "drizzle" | "prisma" | "openapi" | "graphql" | "trpc" | "convex" | "json-schema";
  name: string;                // canonical: lowercased, singularized
  fields: { name: string; type: string; optional: boolean; default?: unknown }[];
  source: { file: string; line: number };
};
```

Use regex/AST per kind. zod: match `z.object({ ... })` assignments. Drizzle: match `pgTable("x", { ... })`. OpenAPI: walk `components.schemas`. Prisma: walk the `.prisma` file's `model` blocks.

### 3. Cluster by canonical name

`user` from a zod form, `users` from a drizzle table, and `User` from openapi.yaml all cluster as `user`. Apply: lowercase, strip trailing `Schema`/`Validator`/`Dto`, singularize.

A cluster with `>=2` claims is a drift candidate.

### 4. Diff each cluster

For each cluster, compute:

- **Field-set diff**: fields present in one claim, missing in another.
- **Type diff**: same field name, different type (`string` vs `number`, `string` vs `string \| null`).
- **Optionality diff**: required in one, optional in another.
- **Default-value diff**: different defaults for the same field.

Score severity:

- `error` — field-set diff between layers that must agree at runtime (form → API, API → DB).
- `warn` — type diff where one is a subset (`string` vs `enum<"a"|"b">` is a warn if app code already constrains).
- `info` — optionality drift inside a UI-only layer (form vs form).

### 5. Pick the single source-of-truth — apply [[skill-compose]] reasoning

This is the structural fix, not a one-line patch. Run the reasoning recipe from `skill-compose`:

**Frame.** "Schema X currently lives in N layers with M divergences. Pick the layer that should be canonical; generate the others from it."

**Axes** (pick ≥3):
- *Authoring ergonomics* — where do humans most naturally write the schema?
- *Type-inference depth* — which canonical form propagates the richest types to the rest?
- *Runtime-validation cost* — which form gives free runtime checking on the trust boundary?
- *Migration cost* — how many call sites change?
- *Generator coverage* — how many of the other layers have a generator from this canonical form?

**Variants** (≥3, kind-not-degree):

| Variant | Canonical layer | Generators | Best for |
|---------|-----------------|-----------|----------|
| `zod-as-truth` | zod schema in `packages/schemas/` | `zod-to-openapi`, `drizzle-zod`, `zod-to-graphql` | Heavy form validation, full-stack TS |
| `db-as-truth` | drizzle/prisma schema | `drizzle-zod`, `prisma-zod-generator`, `openapi-typescript` (DB-first) | DB-driven apps, complex relations |
| `openapi-as-truth` | hand-written or hosted spec | `openapi-typescript`, `openapi-to-zod`, `prisma-openapi` | Polyglot teams, external API surface |
| `trpc-or-convex-as-truth` | single TS router file | none needed — types flow at compile time | Greenfield, no external HTTP API |
| `graphql-codegen` | SDL or `.graphql` files | `graphql-codegen` per consumer | Large client teams, federated GraphQL |

**Weakest links**: write each. `zod-as-truth` weakest = SQL types lose precision. `db-as-truth` weakest = forms get generated naming. `openapi-as-truth` weakest = TS DX is worst. `trpc-as-truth` weakest = no external API surface. `graphql` weakest = setup cost.

**Eliminate** variants whose weakest link is a hard constraint (e.g. "external partners consume our API" rules out tRPC).

**Pick** the Pareto-best survivor; justify in one paragraph.

### 6. Propose one concrete next move

Surface a single recommendation, not a list:

> "Cluster `user` has 3 divergent claims (zod form, drizzle table, openapi spec). Recommend `zod-as-truth` because (a) you already use zod for forms, (b) `drizzle-zod` and `zod-to-openapi` cover both other layers, (c) the weakest link (SQL type loss) doesn't apply — your tables are all simple. Concrete move: (1) move `userSchema` to `packages/schemas/user.ts`, (2) generate drizzle table via `drizzle-zod`, (3) generate openapi via `zod-to-openapi`, (4) add `npm run schema:check` running both generators + git diff."

Stop. Wait for the user to approve before editing.

## Constraints

- **Don't fix without recommending the canonical layer first.** Patching the divergence layer-by-layer creates the same drift again next sprint.
- **Don't assume the stack.** If the user runs Prisma + Yup + manual openapi.yaml, recommend tools for *that* combo — don't push your favorites.
- **Don't auto-run codegen.** Suggest the command; let the user invoke it. Codegen overwrites hand-edits silently.
- **Respect "intentional divergence" markers.** If a schema has `// drift-ok: ui-only` above it, skip it.
- **Don't flag enum widening.** A backend enum gaining a value while a form keeps the old set is forward-compatible, not drift.

## Verification

```bash
# After applying the canonical refactor, all generators must round-trip:
npm run schema:check       # user-defined; should exit 0
git diff --exit-code        # no generator output should change
```

If the user has neither, propose adding `schema:check` to `package.json` as the final step.
