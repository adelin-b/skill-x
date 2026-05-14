---
name: skill-compose
description: Combine two or more existing skills into a new derived skill governed by a composition rule. Apply structured reasoning — frame the cross-cutting concern, choose comparison axes, generate ≥3 variants of different kind, label each weakest link, eliminate dominated options, pick the Pareto-front variant best aligned with the rule, and persist the rationale in frontmatter so future readers can see what was rejected and why. Use whenever the user says "compose these skills", "merge skill X with skill Y", "I want a skill that does both", "convert all Convex into Zod", or any phrasing where a cross-cutting rule needs to apply across multiple libraries simultaneously. Also re-run automatically whenever `skill-sync` reports a parent skill was re-synced — derived skills go stale the moment one of their sources changes.
---

# skill-compose

A *derived* skill is a SKILL.md whose frontmatter has a non-empty `composed_from` list, a `compose_rule` string, and an explored `compose_variants[]` array recording the alternatives that were considered.

## When to trigger

- User asks to combine two skills.
- User describes a cross-cutting rule that spans libraries ("only use X for Y", "always express Z through W").
- `tools/compose.mjs` reports a derived skill as `STALE` (a parent was re-synced more recently than the child's `last_synced`).
- `skill-audit` flagged an integration opportunity in the active stack.

## The reasoning recipe (do this every compose — never skip)

A derived skill is a *decision*, not just a merger. The body the LLM writes commits the user to one way of combining the parents over many alternatives. Make the alternatives explicit so the choice is auditable.

### 1. Frame

State the cross-cutting concern in one sentence: what makes the parents alone insufficient, and what success looks like. Pull constraints + acceptance from the user's prompt. If the user only said "compose X with Y", ask one clarifying question about what they want the combination to optimize for; do not invent.

### 2. Choose axes (≥3)

Pick comparison dimensions BEFORE generating variants. Each axis needs a name, a polarity (higher better / lower better), and a measurable definition. Examples for code-style composes:

- `ergonomics` — number of concepts the user has to hold in their head per call (lower better)
- `type-inference-quality` — does the static type narrow correctly without manual annotations (higher better)
- `runtime-cost` — extra ms / allocation per call vs the cheaper parent alone (lower better)
- `dep-weight` — extra packages or build-step dependencies (lower better)
- `escape-hatch-surface` — easy is it to drop back to a parent's primitives when the rule doesn't fit (higher better)
- `debuggability` — error messages point to the user's code or to the integration glue (higher better)

Pick axes that genuinely matter to the `compose_rule`. Subjective axes (maintainable, simple, scalable) must be unpacked into measurable specifics first.

### 3. Generate variants (≥3, kind not degree)

Force diversity. Variants must differ in **kind**, not in degree (not "v1 with 100ms timeout vs v1 with 200ms timeout"). At least one variant must NOT use the obvious-default approach.

For each variant capture:

```yaml
- id: <kebab-case-slug>
  summary: <one-line: which parent leads, what the integration glue is>
  weakest_link: <the single thing that most plausibly breaks this approach>
  stepping_stone: false   # true if this variant is not best-now but unblocks future options
```

### 4. Eliminate, then Pareto

- Drop any variant that violates a hard constraint stated in the `compose_rule`. Eliminate, do NOT score-down.
- Of what remains, compute the Pareto front: a variant survives if no other variant beats it on every axis. A dominated variant is dropped.

### 5. Pick + justify

From the Pareto front, pick the variant best aligned with the user's `compose_rule` intent. Write `selection_rationale` referencing the dropped variants by id ("X dominated Y on dim D, ergonomics tied; Z violates the no-codegen constraint"). The rationale is for a future reader who never saw this conversation.

### 6. Stamp

Write all of the above into the derived SKILL.md frontmatter. The body of the SKILL.md is then written under the chosen variant — concrete patterns, gotchas, examples — not under abstract trade-offs.

## Frontmatter contract for a derived skill

```yaml
---
name: <name>
description: <pushy description with trigger phrases>
composed_from:
  - <parent-1>
  - <parent-2>
compose_rule: |
  <plain-English instructions for how to combine the parents>
compose_variants:
  - id: <variant-1>
    summary: <one line>
    weakest_link: <what bounds quality>
    stepping_stone: false
  - id: <variant-2>
    summary: <one line>
    weakest_link: <what bounds quality>
  - id: <variant-3>
    summary: <one line>
    weakest_link: <what bounds quality>
selected: <variant-1 | variant-2 | variant-3>
selection_rationale: |
  <why the selected variant beats the others; reference dropped variants>
weakest_link: <what most plausibly breaks the chosen variant>
valid_until: 2026-12-01    # optional — re-evaluate after this date
sources: []
last_synced: <now>
upstream_hash: ~
triggers:
  - kind: prompt
    value: "<phrase that should fire this skill>"
---
```

## Workflow (one-shot version)

1. **Identify parents and rule.** Capture parent skill names and the user's compose_rule. Parents must exist as primary skills (`sources` non-empty).
2. **Detect staleness for existing derived skills:**

   ```bash
   node tools/compose.mjs
   ```
3. **Read inputs.** Read each parent's SKILL.md (frontmatter + body) and the current derived SKILL.md if it exists (preserve the user-edited description).
4. **Run the reasoning recipe** above. Capture variants, weakest links, Pareto front, selection rationale.
5. **Write the body** under the chosen variant. Cite both parents' versions / `last_synced` so the reader knows what era of the upstreams the body assumes. Stay under 6 KB.
6. **Stamp** the derived skill's frontmatter (`compose_variants`, `selected`, `selection_rationale`, `weakest_link`, fresh `last_synced`, combined `upstream_hash`).

## Constraints

- **Parents must be primary**, not derived. Two-hop composition is forbidden — keep cascade predictable.
- **`compose_rule` is durable.** Never rewrite it during a recompose triggered by parent drift. Only rewrite when the user explicitly asks for a new direction.
- **Recompose preserves prior variants where still valid.** If a re-sync only changed an example, the variants set is unchanged; only `selection_rationale` may need a sentence on what bumped.
- **Naming.** Derived skill names should signal the combination — `convex-with-zod`, not `convex-zod` (ambiguous) and not `super-convex` (opaque).

## Verification

```bash
node tools/compose.mjs --check        # exit 1 if any derived skill is stale
node tools/skill-validate.mjs --strict # exit 1 if compose_variants/selected/rationale missing
node tools/audit.mjs --check          # exit 1 on weak composes (variants_count < 2)
```
