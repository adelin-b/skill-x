---
name: skill-audit
description: Scan every SKILL.md in this repo plus the project's package.json and propose the highest-leverage next move — compose two parents that should integrate, narrow contradictory triggers, recompose a weak derived skill, or refresh a stale primary. Use whenever the user says "audit skills", "what's missing", "which skills should be composed", "are any skills contradicting", "is anything stale", or proactively at the start of any session in a repo that has skill-x installed.
sources: []
composed_from: []
compose_rule: ""
last_synced: 1970-01-01T00:00:00Z
upstream_hash: ~
triggers:
  - kind: prompt
    value: "audit skills"
  - kind: prompt
    value: "what's missing"
---

# skill-audit

Procedural skill that runs the deterministic scanner (`tools/audit.mjs`) then interprets the JSON to propose moves. The scanner does the boring work (find pairs, detect collisions, age-out stale things). This skill does the reasoning on top.

## When to trigger

- User says "audit skills", "what's missing", "compose what next", "any contradictions".
- Session start in a repo that already has `skill-x` installed (cheap to run, surfaces drift).
- After `skill-sync` re-syncs a primary — composes downstream of it may now be weak.
- Before publishing a release.

## Workflow

1. **Run the scanner.**

   ```bash
   node tools/audit.mjs --write
   ```

   Writes `.skill-x/audit.json` (machine) and `.skill-x/audit.md` (human). Read the JSON.

2. **Pick the highest-leverage finding.** Score each finding by:

   - **Impact** — how much breakage / wasted effort the user avoids by acting on it. Contradictions usually beat stale primaries; integration opportunities matched against the active stack beat speculative ones.
   - **Tractability** — how cheap the next move is. Recomposing a weak compose is one skill-compose call; resolving a contradiction may need user judgment.
   - **Reversibility** — favour reversible first moves.

   Use `leverage = impact × tractability` as a rough tiebreaker. Surface the top 3.

3. **For each surfaced finding, propose a concrete move:**

   - `integration-opportunity` → propose composing the parents. Frame: "the project uses both X and Y; no derived skill resolves their cross-cutting concerns. Want me to draft `<X>-with-<Y>`?" Hand off to `skill-compose`.
   - `contradiction-candidate` → three options: (a) compose them into a derived skill that resolves the rule explicitly; (b) narrow each skill's `triggers[]` so they no longer overlap; (c) mark one `superseded_by` the other for the affected matcher. Ask the user which.
   - `weak-compose` → the derived skill has fewer than 2 explored variants. The Pareto front is undefined. Propose re-running `skill-compose` and forcing ≥3 variants of different kind.
   - `stale-primary` → propose `skill-sync` for the named skill. If multiple, batch.
   - `expired-validity` → the chosen variant's reasoning has aged out; recompose under fresh constraints.

4. **Do NOT auto-execute.** Surface, propose, wait for the user. The audit's job is to make the next move obvious, not to make it.

## Constraints

- **Don't fabricate findings.** If the scanner reports nothing, say so. Hallucinating contradictions wastes the user's time.
- **Don't double-count.** A weak compose between two primaries that are also a stale-primary candidate counts as one issue (resolve in compose-recompose order).
- **Respect the user's narrowing decisions.** If they previously decided two skills shouldn't be composed (recorded as a `note:` in the derived skill or in `.skill-x/`), don't suggest the same compose every audit.

## Verification

```bash
node tools/audit.mjs --check
```

Exit 0 = no blocking findings. Exit 1 = at least one contradiction or weak compose. CI can gate on this.
