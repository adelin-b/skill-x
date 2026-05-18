---
name: code-drift
description: Detect when code drifted from its upstream truth — shims for upstream bugs that have been fixed, workarounds waiting on a closed issue, deprecated APIs still in use, broken doc/path references, packages on outdated versions that already expose the feature we currently work around, and intra-repo pattern divergence (three idioms for the same operation). Inspired by mex-agent's claims-IR + checker model. Two-phase — cheap deterministic detection via off-the-shelf tools, AI is only invoked for the fix with a focused brief. Use whenever the user says "code drift", "is this still needed", "can we remove the workaround", "upstream fixed yet", "any TODOs expired", "pattern check", "are we behind", or proactively after a dependency bump.
sources: []
composed_from: []
compose_rule: ""
last_synced: 1970-01-01T00:00:00Z
upstream_hash: ~
category: drift-detection
triggers:
  - kind: prompt
    value: "code drift"
  - kind: prompt
    value: "can we remove the workaround"
  - kind: prompt
    value: "upstream fixed yet"
  - kind: prompt
    value: "any TODOs expired"
  - kind: file-change
    value: "package.json"
  - kind: file-change
    value: "package-lock.json"
  - kind: cron
    value: "daily"
---

# code-drift

Code rots in five distinct ways. Each rot is its own checker. Detection is zero-LLM by design — off-the-shelf tools already do it well. The skill's job is to invoke the right detectors for the stack, fold their output into one inventory, score it, and only then hand a focused brief to an AI for the fix.

The design is lifted from [`mex-agent`](https://github.com/theDakshJaitly/mex): claims-as-IR + many checkers + linear additive score + two-phase detect/fix. We extend it from "doc-vs-codebase" to "code-vs-upstream-truth".

## When to trigger

- User says: "code drift", "can we remove the workaround", "upstream fixed yet", "any TODOs expired", "pattern check", "are we behind on this lib".
- `package.json` or `package-lock.json` changed — new versions may close shims.
- Daily cron (cheap; most signals are remote — gh issues, npm registry).
- Before a major-version dependency bump (find shims to retire).
- Before a release (broken doc links shouldn't ship).

## The five drift kinds

| Kind | Definition | Primary detector | Severity cost |
|------|------------|------------------|---------------|
| `shim-resolvable` | Workaround for an upstream issue that is now closed/fixed/released | `gh issue view`, `npm view <pkg> versions` | 10 (error) |
| `version-stale` | Project pinned to a version older than the one that exposes a feature we hand-rolled | `npm-check-updates`, `npm view`, changelog scan | 5 (warn) |
| `pattern-divergence` | 3+ different idioms in the repo for the same operation | `dependency-cruiser`, `jscpd`, custom AST grep | 3 (warn) |
| `doc-path-broken` | A URL or file path referenced in code/docs no longer resolves | `lychee`, `markdown-link-check`, `fs.exists` | 3 (warn) |
| `dep-unused` | Declared dependency with zero imports / dead export | `knip`, `depcheck`, `ts-prune` | 1 (info) |

Score = `100 − Σ cost`. Floor at `−∞` so on-fire repos surface honestly.

## Workflow

### 1. Build the claims inventory — zero tokens

For each drift kind, harvest typed claims from the repo.

```ts
type DriftClaim =
  | { kind: "shim-resolvable"; ref: { provider: "github"; owner: string; repo: string; issue: number }; file: string; line: number; comment: string }
  | { kind: "version-stale"; pkg: string; pinned: string; latest: string; feature?: string; file: string }
  | { kind: "pattern-divergence"; pattern: string; idioms: { snippet: string; file: string; line: number }[] }
  | { kind: "doc-path-broken"; target: string; file: string; line: number; reason: "404" | "ENOENT" | "timeout" }
  | { kind: "dep-unused"; pkg: string; via: "knip" | "depcheck" | "ts-prune" };
```

**Harvesters per kind:**

- `shim-resolvable` — grep for `TODO(by: gh:owner/repo#NN)`, `// shim:`, `// workaround for #NN`, `// remove when <pkg>@<ver>`. Each match is one claim.
- `version-stale` — `npm-check-updates --jsonUpgraded` for the raw set. Cross-reference with `shim-resolvable` claims: if a shim names `pkg@>=X` and `latest>=X`, upgrade the claim's severity to `error`.
- `pattern-divergence` — for known multi-idiom seams (date formatting, HTTP fetch, error throwing, env var reading), AST-grep each idiom and emit one claim per cluster with `>=3` members.
- `doc-path-broken` — `lychee --format json --no-progress '**/*.md' 'src/**/*.{ts,tsx,js,jsx}'` then keep entries with status≥400 or ENOENT. URLs in code that look like docs (`https://`) count.
- `dep-unused` — `knip --reporter json` is enough; merge `dependencies` + `unusedDeps`.

### 2. Run only the detectors the stack supports

Read `package.json` + `which gh`. If `knip` is absent, suggest installing it once, do not error. If `gh` is absent, skip `shim-resolvable` GH lookups and degrade to "issue ref not verified". Same for `lychee`/`markdown-link-check`.

### 3. Apply MEX-style severity rules

Steal four patterns from MEX directly:

1. **Negation via section heading.** Inside `## Intentional workarounds` or `## Won't fix`, claims are suppressed (`negated: true`). Don't relitigate decisions.
2. **Severity downgrade in safe directories.** `examples/`, `fixtures/`, `__tests__/` downgrade `pattern-divergence` from warn to info — divergence in tests is often intentional.
3. **Allowlist for false positives.** Maintain `KNOWN_NONDRIFT_DEPS` for packages we will *never* upgrade (peer-pinned, lockstep with a sibling, framework-mandated).
4. **Combine multi-signal staleness into one issue at max severity.** A shim that is both `version-stale` and has a closed upstream issue is *one* `shim-resolvable` at severity `error`, not two findings.

### 4. Score and group

Score the repo: `100 − Σ cost`. Group findings by file for human readability. Sort groups by total cost descending.

### 5. Two-phase: detect cheap, fix expensive

Detection is everything above — pure tooling, runs in CI. The fix step is where the LLM enters. Hand it *only*:

- the affected file(s) + the specific claim
- the closed upstream issue body (if `shim-resolvable`)
- the changelog entry showing the feature lands in `latest` (if `version-stale`)
- the canonical idiom to converge on (if `pattern-divergence`)

This keeps token cost proportional to the actual fix size, not the repo size.

### 6. Loop

After applying fixes, re-run detection. Score should rise. If it didn't, the fix didn't address the claim — re-brief, don't ship.

## Bootstrap on a new repo

The skill installs itself when invoked the first time in a new repo:

1. Detect missing detectors (`knip`, `lychee`, `npm-check-updates`).
2. Propose adding them as devDependencies (one-shot npm install with user confirmation).
3. Drop a `.code-drift.json` config carrying the `KNOWN_NONDRIFT_DEPS` allowlist + pattern definitions (initially empty).
4. Add `code-drift:check` script to `package.json` that runs the harvesters and exits non-zero on score < threshold.
5. Optional: add the same as a pre-push hook via `simple-git-hooks`.

User can decline any step. The skill works in read-only mode without it.

## Constraints

- **Detection stays deterministic.** No LLM calls in the harvesters. If a detector is unsure, claim is `severity: info` with `reason: "unverified"` and the LLM is asked at fix time.
- **Don't move beyond the claim's scope.** A `shim-resolvable` brief contains the shim file and the closed issue; do not refactor unrelated code in the same fix.
- **Don't break the score across runs.** When suppressing a claim via `negated`, record the decision in `.code-drift.json` with a reason — the next audit must not relitigate.
- **Don't fight package-pin policies.** `pnpm overrides`, `resolutions`, `peerDependenciesMeta`, and `frozen-lockfile` CI all signal the project deliberately holds versions. Treat as an implicit `KNOWN_NONDRIFT_DEPS` entry.

## Verification

```bash
# Re-detect after fix:
npx knip --reporter json | jq '.dependencies | length'   # should drop
gh issue view <NN> --json state                          # should be CLOSED for resolved shims
git grep -nE 'TODO\(by:|shim:|workaround for #' src/      # remaining claims after fix
```

For CI gating, the bootstrap step writes `code-drift:check` — that's the gate.

## Relationship to other skills

- `code-drift` reports drift. `skill-sync` reports drift in *skills themselves*. They share the same mental model; different targets.
- For schemas specifically, defer to [[schema-drift]] — its diff is structural across layers, not lifetime-based.
- For "should we even have this pair of skills?" → run [[skill-audit]].
