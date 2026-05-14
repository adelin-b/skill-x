---
name: skill-sync
description: Detect and repair drift between a skill and its upstream sources (npm packages, docs pages, changelogs, GitHub releases). Use whenever the user says "sync skills", "update skills", "check skill drift", "regenerate skill", "did Zod release something new", or whenever a `package.json` lockfile bumps a dependency that has a corresponding skill in this repo. Also use proactively at the start of any task that depends on a skill whose `last_synced` is more than 30 days old.
---

# skill-sync

Skills here track upstream sources via this frontmatter contract:

```yaml
sources:
  - kind: npm | docs | changelog | github-release
    package: <pkg>          # for kind=npm
    range: "^3"             # for kind=npm — informational
    url: <url>              # for kind=docs / kind=changelog
    repo: owner/repo        # for kind=github-release
last_synced: <ISO timestamp>
upstream_hash: sha256:...
```

When upstream signals change, the recorded `upstream_hash` no longer matches the live one — that's drift. This skill closes the loop.

## When to trigger

- User says: "sync", "update skills", "check drift", "regenerate skill X".
- A `package.json` was just edited and one of the bumped packages appears in any skill's `sources[].package`.
- Cron tick (daily routine) wants to keep skills fresh.
- Any other skill in this repo cannot answer a question because its content looks stale (e.g., it talks about `z.object` shape that no longer matches latest Zod).

## Workflow

1. **Detect**. Run:

   ```bash
   node tools/sync.mjs
   ```

   The script writes a manifest per skill to `manifest/<skill>.json` with the live signals and reports `[DRIFT]` or `[ok]` for each. Read the report — do not guess from `git log`.

2. **Pick a target**. For each skill marked `DRIFT`:

   - Read `manifest/<skill>.json` to see *which* source drifted (npm version bumped? changelog hash changed? docs page edited?).
   - Read the current `skills/<skill>/SKILL.md` body.
   - Fetch the new upstream content for context. For `kind: npm`, fetch the package's latest README from `https://registry.npmjs.org/<pkg>/latest` then `dist.tarball` (or `https://unpkg.com/<pkg>/README.md` for a quick read). For `kind: docs` / `kind: changelog`, fetch the URL. Use `mcp__plugin_context-mode_context-mode__ctx_fetch_and_index` so raw HTML never enters context.

3. **Regenerate**. Rewrite the SKILL.md body to reflect upstream changes:

   - Preserve the skill's *purpose* and *trigger description* — those are user-facing and stable.
   - Update API names, examples, options, breaking-change call-outs.
   - Add a short "Recent changes" note at the bottom citing the new version/date if non-trivial.
   - Keep the file shorter than 4 KB unless the skill clearly needs more.
   - **Do not** invent APIs. If unsure, fetch more docs.

4. **Stamp**. After rewriting:

   ```bash
   node tools/sync.mjs --commit --skill <name>
   ```

   This bumps `last_synced` and `upstream_hash` to match the manifest.

5. **Cascade**. Run:

   ```bash
   node tools/compose.mjs
   ```

   Any derived skill (`composed_from` non-empty) whose source was just re-synced will be marked `STALE`. Hand those over to `skill-compose` to recompose, or invoke `skill-compose` yourself for each.

## Constraints

- **Never fabricate the new content.** Always fetch upstream first.
- **Never edit `last_synced` or `upstream_hash` by hand** — only `tools/sync.mjs --commit` may write them, since it copies from the verified manifest.
- **Never delete a primary skill** during sync. If a package has been deprecated upstream, write that fact into the body and tag the description as "deprecated" — let the user decide.
- **Skills with empty `sources` are ignored**. They are pure procedural skills (e.g., `skill-sync` itself) and have no upstream.

## Verification

Before claiming done:

```bash
node tools/sync.mjs --check
```

Exit 0 = no drift remains. Exit 1 = something is still drifted; keep going.

## Failure modes

- **Network error** for a source — the manifest records `error:` and computes a `liveHash` that includes `err:<msg>`. This will *always* show drift while the source is unreachable. Don't paper over it: surface the error to the user and skip stamping.
- **YAML in frontmatter is non-trivial** — `tools/lib.mjs` parses a deliberately small subset. If parsing fails, the script throws. Fix the frontmatter to fit (scalars, dashed lists, nested key/value under list items).
- **No `sources` field on a skill that should have one** — add it. The skill silently skips otherwise.
