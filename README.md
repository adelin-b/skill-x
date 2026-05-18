# skill-x

skills.sh-compatible monorepo of [Agent Skills](https://agentskills.io) that **stay current** with their upstreams, **compose** with each other, and detect **drift** across schemas and code.

## Why

Three gaps in agent skills today:

1. **Skill drift** — a skill written against `zod@3` rots when `zod@4` ships.
2. **Cross-cutting rules** — "use Zod for every Convex schema" is a *combination* of two skills, not a third hand-written skill that diverges from its parents.
3. **Code drift** — schemas drift across forms/API/DB; workarounds outlive the upstream bugs they shim; idioms multiply silently inside a single repo.

This repo ships five skills across three categories:

### `skill-meta` — operate on skills themselves

- `skill-sync` — detects upstream drift (npm version, changelog hash, docs hash, GitHub release hash), regenerates the affected SKILL.md, bumps `last_synced`/`upstream_hash`.
- `skill-audit` — scans every SKILL.md plus the project's `package.json`. Surfaces integration opportunities, trigger contradictions, weak composes, stale primaries, expired validity. Recommends the highest-leverage next move.

### `composition` — derive new skills from existing ones

- `skill-compose` — merges N source skills into a derived skill under a composition rule. Applies a structured reasoning recipe (frame → axes → ≥3 variants → weakest links → Pareto → pick + justify) and persists `compose_variants[]` + `selected` + `selection_rationale` in the derived skill's frontmatter so future readers see what was rejected and why.

### `drift-detection` — keep code aligned with its declared truth

- `schema-drift` — detect schemas drifted across forms/API contracts/DB models/GraphQL/tRPC/Convex. Inventory the stack, recommend the single source-of-truth pattern, propose one concrete refactor with the right tool to enforce it.
- `code-drift` — detect code drifted from upstream truth: shims for closed issues, deprecated APIs, broken doc/path references, version-stale workarounds, intra-repo pattern divergence. Two-phase — zero-LLM detection via `knip` / `lychee` / `ncu` / `gh` CLI, AI invoked only for focused fixes. Inspired by [`mex-agent`](https://github.com/theDakshJaitly/mex).

A worked end-to-end example (`zod-base` + `convex-base` → `convex-with-zod`) lives under [`examples/`](./examples/README.md). It is not shipped to marketplaces — it is purely a test fixture and reference implementation of the frontmatter contract.

## Install matrix

`skill-x` follows the open [Agent Skills standard](https://agentskills.io) (SKILL.md frontmatter + body), so the same skill files work across every major AI coding tool. The Claude marketplace ships **each skill as its own plugin entry** with `category` + `tags` + `keywords` for filtering — pick the bundle you want or install them à la carte. Pick whichever install path fits your tool:

| Target | Install command |
|--------|-----------------|
| **Claude Code** (plugin marketplace, all) | `/plugin marketplace add adelin-b/skill-x` then `/plugin install <skill-name>@adelin-b` per skill |
| **Claude Code** (à la carte examples) | `/plugin install skill-sync@adelin-b`, `/plugin install schema-drift@adelin-b`, `/plugin install code-drift@adelin-b` |
| **Codex CLI** | `skill-installer adelin-b/skill-x` *or* copy `skills/` to `~/.agents/skills/` |
| **Universal** (Cursor, Windsurf, Aider, Gemini CLI, OpenCode, Antigravity, +others) | `npx openskills install adelin-b/skill-x --universal` |
| **skills.sh directory** | `npx skills add adelin-b/skill-x --all` |
| **Multi-tool authoring** (rulesync) | `npx rulesync import --targets skill-x` then `npx rulesync generate` |
| **MCP-capable agent** (any) | Add to MCP config: `{ "command": "node", "args": ["tools/mcp-server.mjs"] }` |

### Categorization

The marketplace exposes three categories. Use them to filter `/plugin` listings.

| Category | Plugins |
|----------|---------|
| `skill-meta` | `skill-sync`, `skill-audit` |
| `composition` | `skill-compose` |
| `drift-detection` | `schema-drift`, `code-drift` |

Categorization lives in [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json). The SKILL.md frontmatter keeps an optional `category:` field for cross-tool consumers that don't read marketplace metadata (skill-audit uses it for grouping).

The MCP server exposes `list_skills`, `check_drift`, `check_compose`, and `stamp_skill` as universal verbs callable from any MCP-aware client.

## Frontmatter convention

Every SKILL.md extends the Agent Skills minimum (`name`, `description`) with:

```yaml
sources:                  # primary skills only — upstream truth
  - kind: npm             # npm | docs | changelog | github-release
    package: zod
    range: "^3"
    docs: https://zod.dev
    changelog: https://github.com/colinhacks/zod/releases.atom
composed_from: []         # derived skills only — parent lineage
compose_rule: ""          # derived skills only — composition prompt
last_synced: 2026-05-06T00:00:00Z
upstream_hash: sha256:... # opaque hash of all source signals
```

Custom fields beyond `name`/`description` are preserved when generators redistribute the file to other tools (openskills, rulesync, etc.).

`skill-sync` and `skill-compose` are the only skills that read/write these fields.

## Layout

```text
skill-x/
├── README.md
├── AGENTS.md                          # universal agent guide (Codex + others auto-read)
├── package.json
├── hooks.spec.json                    # single source for cross-tool hooks
├── .claude-plugin/
│   ├── plugin.json                    # Claude Code plugin (hooks block generated)
│   └── marketplace.json               # Claude marketplace index
├── agents/
│   └── openai.yaml                    # Codex CLI invocation policy (generated)
├── .github/workflows/
│   └── skill-x-drift.yml              # universal CI fallback (generated)
├── skills/                            # production skills (shipped to marketplaces)
│   ├── skill-sync/SKILL.md            # [skill-meta]       detect upstream drift
│   ├── skill-audit/SKILL.md           # [skill-meta]       cross-skill audit + recommendations
│   ├── skill-compose/SKILL.md         # [composition]      compose derived skills with embedded reasoning
│   ├── schema-drift/SKILL.md          # [drift-detection]  cross-layer schema drift
│   └── code-drift/SKILL.md            # [drift-detection]  workarounds, deprecations, broken refs
├── examples/                          # worked example — test fixture only
│   ├── README.md
│   ├── skills/
│   │   ├── zod-base/SKILL.md          # primary (npm + docs + changelog)
│   │   ├── convex-base/SKILL.md       # primary (npm + docs + changelog)
│   │   └── convex-with-zod/SKILL.md   # derived (zod-base + convex-base)
│   └── manifest/                      # cached upstream signals for examples
│       ├── zod-base.json
│       └── convex-base.json
├── manifest/                          # cached upstream signals for production skills
└── tools/
    ├── lib.mjs                        # frontmatter, hashing, fetch helpers
    ├── sync.mjs                       # drift detection (CLI + library)
    ├── compose.mjs                    # staleness detection (CLI + library)
    ├── mcp-server.mjs                 # universal MCP verb surface
    └── gen-hooks.mjs                  # generates per-tool hook configs
```

## Triggers

`skill-sync` runs four ways:

1. **Manual** — invoke from any agent: "sync skills" / "check skill drift".
2. **MCP** — call `skill_x__check_drift` tool from any MCP-aware client.
3. **Hook** — PostToolUse on `package.json` edits (Claude Code via `.claude-plugin/plugin.json`, Codex via `agents/openai.yaml`).
4. **CI** — `.github/workflows/skill-x-drift.yml` fires on push of `package.json`/`skills/**` and on a daily cron.

`skill-compose` runs:

1. **Manual** — "compose convex with zod".
2. **MCP** — call `skill_x__check_compose` tool.
3. **Cascade** — `skill-sync` automatically queues recompose for any derived skill whose parent was re-synced.

## Hook portability

Hook config format is not standardized across AI coding tools (Claude Code, Codex, Cursor, Copilot all ship their own). `skill-x` paves over the gap with a single source — `hooks.spec.json` — and a generator (`tools/gen-hooks.mjs`) that emits each per-tool config. Regenerate after editing the spec:

```bash
npm run gen-hooks
```

Adds Claude Code plugin hooks, Codex invocation policy, and a GitHub Actions workflow as universal fallback.

## Development

```bash
npm install
npm run check         # lint + validate + tests (one-shot CI gate)
npm test              # unit tests only (26 tests)
npm run lint          # Biome lint (JS + JSON)
npm run lint:fix      # Biome lint with auto-fix
npm run validate      # SKILL.md frontmatter linter
npm run sync          # detect drift across all primary skills
npm run compose       # detect staleness across all derived skills
npm run mcp           # start MCP server (stdio)
npm run gen-hooks     # regenerate per-tool hook configs
npm run audit         # cross-skill audit (human report)
npm run audit:write   # write .skill-x/audit.{json,md}
npm run audit:check   # CI gate: exit 1 on contradictions or weak composes

# Worked example end-to-end (does not touch production skills/)
npm run example:check     # validate + compose against examples/
npm run example:sync      # drift check against examples/
```

## CI pipelines

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `.github/workflows/check.yml` | push/PR | `npm run check` + verify generated hook configs are committed |
| `.github/workflows/mega-linter.yml` | push/PR | MegaLinter — YAML, Markdown, GitHub Actions, secrets (gitleaks), Trivy security scan |
| `.github/workflows/skill-x-drift.yml` | push to skills/package, daily cron | upstream drift + derived-skill staleness check |

Biome lints JS + JSON. MegaLinter covers the rest (YAML, Markdown, Actions, secrets). No double-linting.

## License

MIT
