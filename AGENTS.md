# AGENTS.md — skill-x

Universal guide for AI coding agents (Claude Code, Codex CLI, Cursor, Gemini CLI, Aider, Windsurf, OpenCode, Antigravity, +others).

## What this repo provides

`skill-x` is a monorepo of [Agent Skills](https://agentskills.io) that **stay current with their upstream sources** and **compose with each other**.

| Skill | Location | Purpose |
|-------|----------|---------|
| `skill-sync` | `skills/` | Detect and repair drift between a skill and its upstream sources (npm packages, docs pages, changelogs, GitHub releases). |
| `skill-compose` | `skills/` | Combine two or more primary skills into a new derived skill governed by a composition rule. Re-compose cascades when a parent re-syncs. |
| `zod-base` | `examples/skills/` | Demo primary skill — runtime schemas with Zod. Not shipped to marketplaces; lives here as a worked example. |
| `convex-base` | `examples/skills/` | Demo primary skill — Convex backend functions. Not shipped; example only. |
| `convex-with-zod` | `examples/skills/` | Demo derived skill — `zod-base` + `convex-base` under a compose rule. Not shipped; example only. |

Production marketplaces only see `skills/skill-sync` and `skills/skill-compose`. The `examples/` tree exists for end-to-end testing of the contract.

## Frontmatter contract

Every SKILL.md extends the Agent Skills minimum (`name`, `description`) with:

```yaml
sources:                  # primary skills only — upstream truth
  - kind: npm             # npm | docs | changelog | github-release
    package: <pkg>
    range: "^3"
    docs: <url>
    changelog: <url>
composed_from: []         # derived skills only — parent lineage
compose_rule: ""          # derived skills only — composition prompt
last_synced: <ISO>        # stamped by tools/sync.mjs --commit
upstream_hash: sha256:... # opaque hash of upstream signals
```

Custom fields beyond `name`/`description` are preserved when generators redistribute the file to other tools (rulesync, openskills, etc.).

## How to invoke

| Action | Command |
|--------|---------|
| Detect upstream drift | `npm run sync` or invoke the `skill-sync` skill |
| Detect derived-skill staleness | `npm run compose` or invoke the `skill-compose` skill |
| CI check (fail on drift) | `node tools/sync.mjs --check` |
| CI check (fail on stale derived) | `node tools/compose.mjs --check` |
| Stamp after body regenerated | `node tools/sync.mjs --commit --skill <name>` |
| Run MCP server (any MCP-capable agent) | `node tools/mcp-server.mjs` |

## Universal install paths

| Target tool | Install command |
|-------------|-----------------|
| Claude Code (marketplace) | `/plugin marketplace add adelin-b/skill-x` then `/plugin install skill-x@adelin-b` |
| Codex CLI | Copy `skills/` to `~/.agents/skills/` or use `skill-installer adelin-b/skill-x` |
| Universal (Cursor, Windsurf, Aider, Gemini, +others) | `npx openskills install adelin-b/skill-x --universal` |
| skills.sh directory | `npx skills add adelin-b/skill-x --all` |
| Multi-tool authoring (rulesync) | `npx rulesync import --targets skill-x` then `npx rulesync generate` |

## Triggers

`skill-sync` activates when:
- User says "sync skills", "update skills", "check drift", "regenerate skill X"
- `package.json` is edited and a bumped dependency appears in any skill's `sources[].package`
- Cron tick (daily) for fresh skills
- Body content looks stale relative to current upstream

`skill-compose` activates when:
- User asks to combine two skills or describes a cross-cutting rule
- `tools/compose.mjs` reports a derived skill as `STALE` (parent re-synced)

## Constraints

- Body regeneration is LLM work. Scripts only detect drift/staleness and stamp — they do not invent content.
- `last_synced` / `upstream_hash` are written only by `tools/sync.mjs --commit`, never by hand.
- Derived skills cannot derive from other derived skills (2-hop composition forbidden; keeps cascade predictable).
- Skills with empty `sources` are treated as pure procedural (e.g., `skill-sync` itself) — no upstream to track.

## License

MIT.
