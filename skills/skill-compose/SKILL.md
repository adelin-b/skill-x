---
name: skill-compose
description: Combine two or more existing skills into a new derived skill governed by a composition rule (e.g. "use Zod for every Convex schema and validator"). Use whenever the user says "compose these skills", "merge skill X with skill Y", "I want a skill that does both", "convert all Convex into Zod", or any phrasing where a cross-cutting rule needs to apply across multiple libraries simultaneously. Also re-run automatically whenever `skill-sync` reports a parent skill was re-synced — derived skills go stale the moment one of their sources changes.
---

# skill-compose

Composition is the second leg of the cross-integration repo. A *derived* skill is a SKILL.md whose frontmatter has a non-empty `composed_from` list and a `compose_rule` string:

```yaml
composed_from:
  - convex-base
  - zod-base
compose_rule: |
  Every Convex argument validator, return validator, and document field
  must be expressed as a Zod schema, then converted to a Convex validator
  via the convex-helpers `zid`/`zCustomQuery` family. Never hand-write a
  Convex `v.object` validator when an equivalent Zod schema is available.
```

The derived skill's *body* is generated from its parents under that rule.

## When to trigger

- User asks to combine two skills.
- User describes a cross-cutting rule that spans libraries ("only use X for Y", "always express Z through W").
- `tools/compose.mjs` reports a derived skill as `STALE` (a parent was re-synced more recently than the child's `last_synced`).

## Workflow

1. **Identify parents and rule.** If the user is creating a *new* derived skill, capture:
   - Parent skills (must already exist in `skills/`; if not, build them as primary skills first via `skill-sync`).
   - The composition rule, written as plain English instructions a future Claude can act on.
   - A name and description for the derived skill — description is "pushy" per skills.sh guidance (include trigger phrases).

2. **Detect staleness for existing derived skills:**

   ```bash
   node tools/compose.mjs
   ```

   Report shows each derived skill as `[ok]` or `[STALE]` with the parent that's newer.

3. **Read inputs.** For the target derived skill:
   - Read each parent's SKILL.md (frontmatter + body).
   - Read the current derived SKILL.md if it exists (preserve user-edited intent in the description).

4. **Generate body.** Produce a SKILL.md body that:
   - Starts with a short framing of *why* this combination exists (the rule).
   - For each high-frequency operation in the parents, shows the **combined** form (not the separate forms).
   - Calls out conflicts where the rule overrides a parent's default ("Convex's `v.object` is not used here — see rule").
   - Cites both parents' versions/last_synced timestamps so a reader knows what era of the upstreams was assumed.
   - Stays under 6 KB. Composition skills must remain readable, not dump both parents.

5. **Write and stamp.**

   - Write the regenerated body via the standard write path.
   - Stamp `last_synced`/`upstream_hash` so subsequent `tools/compose.mjs` runs report `[ok]`. The hash for a derived skill is the combination of its parents' current `upstream_hash` values:

     ```js
     import { combineHashes, readSkill } from "../tools/lib.mjs";
     const parents = await Promise.all(lineage.map(readSkill));
     const hash = combineHashes(parents.map((p) => p.frontmatter.upstream_hash));
     ```

     Then call `tools/sync.mjs --commit --skill <name>` after writing the new hash into the frontmatter, OR (simpler) write `last_synced: <now>` and `upstream_hash: <combined>` directly via `writeSkill` and skip the commit script — derived skills don't have `sources`, so `sync.mjs --commit` would refuse to compute a hash anyway.

## New-derived-skill scaffold

When a user wants a brand-new derived skill, scaffold it like this before generating the body:

```yaml
---
name: <name>
description: <pushy description with trigger phrases>
composed_from:
  - <parent-1>
  - <parent-2>
compose_rule: |
  <plain-English instructions for how to combine the parents>
sources: []
last_synced: <now>
upstream_hash: ~
---
```

Then run the workflow step 4 onward.

## Constraints

- **Parents must exist and have sources.** A derived skill cannot be derived from another derived skill — that's two-hop composition and gets confusing fast. Parent must have `sources: [...]` (i.e. be a primary skill).
- **The compose_rule is durable.** It is the user's intent; never rewrite it during a recompose triggered by parent drift. Only rewrite it when the user explicitly asks.
- **Naming.** Derived skill names should signal the combination, e.g. `convex-with-zod`, not `convex-zod` (ambiguous) and not `super-convex` (opaque).
- **Don't recurse.** A recompose only reads parents; it does not check the parents themselves for drift. That's `skill-sync`'s job. If you suspect a parent is stale, run `skill-sync` first, then `skill-compose`.

## Verification

```bash
node tools/compose.mjs --check
```

Exit 0 = no derived skill is stale. Exit 1 = at least one is.
