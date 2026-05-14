# Publishing & Using skill-x

End-to-end guide: how to publish this repo, and how end users install it across every major AI coding tool.

---

## 1. Pre-publish checklist

Before the first push, verify:

```bash
npm install
npm run check          # lint + validate + tests
node tools/gen-hooks.mjs   # regenerate per-tool hook configs
```

All four steps should pass clean. Then:

```bash
git add -A
git commit -m "feat: skill-x v0.1.0 universal scaffold"
```

---

## 2. Publish to GitHub

```bash
gh repo create adelin-b/skill-x --public --source=. --remote=origin --push
```

(Or create manually at <https://github.com/new> and `git push -u origin main`.)

The repo URL `https://github.com/adelin-b/skill-x` is the canonical reference every install path below points to.

Tag a release once stable:

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --generate-notes
```

---

## 3. Publish to each distribution channel

### 3.1 Claude Code plugin marketplace (Anthropic-managed)

1. Fill the **plugin directory submission form** linked from <https://github.com/anthropics/claude-plugins-official>.
2. Provide repo URL `https://github.com/adelin-b/skill-x` and confirm `.claude-plugin/marketplace.json` validates with `claude plugin validate .`.
3. Review takes a few days.

While waiting, users can already install directly:

```text
/plugin marketplace add adelin-b/skill-x
/plugin install skill-x@adelin-b
```

### 3.2 skills.sh directory

`skills.sh` indexes public GitHub repos that contain `SKILL.md` files automatically. No submission needed. After push:

1. Wait a few hours.
2. Visit <https://www.skills.sh/> and search for `skill-x` or `adelin-b/skill-x`.
3. If absent after 24 h, submit via the directory's submission form (link in their footer).

### 3.3 OpenSkills (universal across 15+ agents)

Zero-config. After the GitHub push, any user runs:

```bash
npx openskills install adelin-b/skill-x --universal
```

OpenSkills clones the repo, materializes skills to `.agent/skills/` (or `.claude/skills/` without `--universal`), and writes `<available_skills>` XML into the user's `AGENTS.md`.

### 3.4 Codex CLI registry

Codex auto-discovers skills under `.agents/skills/` in repositories and `~/.agents/skills/` per-user. Two install paths:

- **Per-user**: `git clone https://github.com/adelin-b/skill-x ~/.agents/skill-x && ln -s ~/.agents/skill-x/skills/* ~/.agents/skills/`
- **Curated installer**: `skill-installer adelin-b/skill-x` (Codex's curated installer). Anthropic does not control this — confirm availability with the Codex team.

### 3.5 npm (optional, for the tooling)

Only useful if downstream wants `skill-sync` + `skill-compose` + MCP server as standalone tools:

```bash
# 1. flip "private": true → false in package.json
# 2. log in
npm login
# 3. publish
npm publish --access public
```

After publish, users can run:

```bash
npx skill-x-mcp                       # boot the MCP server
npx skill-sync --check                # CI drift gate
npx skill-compose --check             # CI staleness gate
```

### 3.6 MCP registry (claude.com, modelcontextprotocol.io, etc.)

Submit the MCP server to MCP directories. Provide:

- Server name: `skill-x`
- Command: `node tools/mcp-server.mjs` (or `npx skill-x-mcp` once on npm)
- Tools exposed: `list_skills`, `check_drift`, `check_compose`, `stamp_skill`
- Repo: `https://github.com/adelin-b/skill-x`

---

## 4. End-user install matrix

| Target | One-line install |
|--------|-----------------|
| Claude Code | `/plugin marketplace add adelin-b/skill-x` then `/plugin install skill-x@adelin-b` |
| Codex CLI | `skill-installer adelin-b/skill-x` or symlink `skills/` into `~/.agents/skills/` |
| Cursor / Windsurf / Aider / Gemini / OpenCode / Antigravity / +others | `npx openskills install adelin-b/skill-x --universal` |
| skills.sh users | `npx skills add adelin-b/skill-x --all` |
| Multi-tool rule authors | `npx rulesync import --targets skill-x && npx rulesync generate` |
| Any MCP-capable client | Add `{ "command": "node", "args": ["tools/mcp-server.mjs"] }` to MCP config (or `npx skill-x-mcp` after npm publish) |

---

## 5. End-user usage (after install)

Once installed, the agent will pick up the SKILL.md files automatically (progressive disclosure — full body loaded only when triggered).

### Triggers

| Action | What the user says |
|--------|---------------------|
| Detect drift | "sync skills", "check drift", "is zod-base stale?" |
| Regenerate skill body | "regenerate zod-base from upstream", "skill-sync zod-base" |
| Compose two skills | "compose convex with zod", "make a derived skill using X + Y" |
| Recompose stale derived skill | "recompose convex-with-zod" or call `skill_x__check_compose` via MCP |

### Direct CLI (skill author / CI)

```bash
node tools/sync.mjs                       # drift report
node tools/sync.mjs --check               # exit 1 on drift (CI gate)
node tools/sync.mjs --commit --skill X    # stamp after regenerating body
node tools/compose.mjs                    # staleness report
node tools/compose.mjs --check            # exit 1 on stale derived (CI gate)
node tools/skill-validate.mjs --strict    # frontmatter lint
node tools/mcp-server.mjs                 # boot MCP stdio server
```

---

## 6. Maintenance flow

After publishing, keep skills fresh:

1. **Daily (automatic)** — `.github/workflows/skill-x-drift.yml` runs `sync.mjs --check` + `compose.mjs --check`. CI red = drift.
2. **On `package.json` edit** — Claude Code hook fires `tools/hook-sync-on-pkg.mjs` → `sync.mjs`. Codex `agents/openai.yaml` mirrors.
3. **Body regeneration** — when sync detects drift, run the `skill-sync` skill from inside an agent. It fetches the new upstream, rewrites the SKILL.md body, calls `tools/sync.mjs --commit --skill <name>`.
4. **Cascade** — after stamping a parent, `compose.mjs` reports any derived skill as `STALE`. Run the `skill-compose` skill to rewrite the derived body under its `compose_rule`.
5. **Hook config drift** — if you edit `hooks.spec.json`, run `npm run gen-hooks` and commit the regenerated `plugin.json` / `openai.yaml` / `skill-x-drift.yml`. `check.yml` CI fails if you forget.

---

## 7. Release cadence

| Change kind | Bump |
|-------------|------|
| Skill body regenerated from upstream | patch |
| New derived skill or compose rule | minor |
| Frontmatter schema change (breaking) | major |

Update `package.json` `version` + `.claude-plugin/plugin.json` `version` + `.claude-plugin/marketplace.json` `version` together. The lint pipeline does not enforce parity yet — eyeball it.

---

## 8. Where to add new skills

```text
skills/<new-skill>/SKILL.md
```

Skeleton:

```yaml
---
name: <new-skill>
description: <pushy 20-500 char description with trigger phrases>
sources:
  - kind: npm
    package: <pkg>
    range: "^1"
  - kind: docs
    url: https://docs.example.com
composed_from: []
compose_rule: ""
last_synced: 1970-01-01T00:00:00Z
upstream_hash: ~
---

# <new-skill> (stub)

First `node tools/sync.mjs` run will mark this DRIFT. Hand off to the `skill-sync` skill from any agent — it fetches upstream and fills in this body.
```

Add the new skill to `.claude-plugin/plugin.json` `skills[]` array, run `npm run check`, commit.
