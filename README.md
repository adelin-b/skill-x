# skill-x

skills.sh-compatible monorepo of [Agent Skills](https://agentskills.io) that **stay current** with their upstreams and **compose** with each other.

## Why

Two gaps in agent skills today:

1. **Drift** — a skill written against `zod@3` rots when `zod@4` ships.
2. **Cross-cutting rules** — "use Zod for every Convex schema" is a *combination* of two skills, not a third hand-written skill that diverges from its parents.

This repo ships two meta-skills:

- `skill-sync` — detects upstream drift (npm version, changelog hash, docs hash, GitHub release hash), regenerates the affected SKILL.md, bumps `last_synced`/`upstream_hash`.
- `skill-compose` — merges N source skills into a derived skill under a composition rule. Records `composed_from` lineage so the derived skill re-composes whenever a parent is re-synced.

A worked end-to-end example (`zod-base` + `convex-base` → `convex-with-zod`) lives under [`examples/`](./examples/README.md). It is not shipped to marketplaces — it is purely a test fixture and reference implementation of the frontmatter contract.

## Install matrix

`skill-x` follows the open [Agent Skills standard](https://agentskills.io) (SKILL.md frontmatter + body), so the same skill files work across every major AI coding tool. Pick whichever install path fits your tool:

| Target | Install command |
|--------|-----------------|
| **Claude Code** (plugin marketplace) | `/plugin marketplace add adelin-b/skill-x` then `/plugin install skill-x@adelin-b` |
| **Codex CLI** | `skill-installer adelin-b/skill-x` *or* copy `skills/` to `~/.agents/skills/` |
| **Universal** (Cursor, Windsurf, Aider, Gemini CLI, OpenCode, Antigravity, +others) | `npx openskills install adelin-b/skill-x --universal` |
| **skills.sh directory** | `npx skills add adelin-b/skill-x --all` |
| **Multi-tool authoring** (rulesync) | `npx rulesync import --targets skill-x` then `npx rulesync generate` |
| **MCP-capable agent** (any) | Add to MCP config: `{ "command": "node", "args": ["tools/mcp-server.mjs"] }` |

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
│   ├── skill-sync/SKILL.md            # detect upstream drift
│   └── skill-compose/SKILL.md         # compose derived skills
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
