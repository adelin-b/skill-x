# examples

End-to-end test fixtures for the `skill-sync` and `skill-compose` meta-skills.

The repo ships **two** real skills under `skills/`:

- `skill-sync` — detect upstream drift
- `skill-compose` — combine N skills into a derived skill

Everything in this directory is a **demo**: it shows how a user would author primary skills (`zod-base`, `convex-base`) and a derived skill (`convex-with-zod`) on top of the contract, and lets the tooling be exercised end-to-end without touching production state.

## Layout

```text
examples/
├── README.md
├── skills/
│   ├── zod-base/SKILL.md          # primary, npm-sourced
│   ├── convex-base/SKILL.md       # primary, npm-sourced
│   └── convex-with-zod/SKILL.md   # derived (zod-base + convex-base)
└── manifest/
    ├── zod-base.json              # cached upstream signals
    └── convex-base.json
```

## Run the meta-skills against the examples

The CLIs honor `SKILL_X_SKILLS_DIR` and `SKILL_X_MANIFEST_DIR` env vars, so they can target this directory without touching the production `skills/` root:

```bash
npm run example:validate     # SKILL.md frontmatter lint
npm run example:sync         # drift report for zod-base + convex-base
npm run example:compose      # staleness check for convex-with-zod
npm run example:check        # validate + compose (one-shot example gate)
```

Equivalent long form:

```bash
SKILL_X_SKILLS_DIR=examples/skills SKILL_X_MANIFEST_DIR=examples/manifest \
  node tools/sync.mjs
```

## End-to-end walkthrough

1. `npm run example:validate` — confirms the three fixtures pass frontmatter lint.
2. `npm run example:sync` — fetches the live npm/docs/changelog signals for Zod and Convex, hashes them, compares against `examples/manifest/*.json`, prints `[DRIFT]` or `[ok]`.
3. If `DRIFT`, regenerate the SKILL.md body by hand (or, in a real install, invoke the `skill-sync` skill from any agent — it reads the manifest, fetches upstream content, rewrites the body, then calls `tools/sync.mjs --commit --skill <name>` with the env vars set).
4. `npm run example:compose` — verifies `convex-with-zod`'s `last_synced` is at least as new as both parents. If a parent was just re-synced, the derived skill goes `[STALE]` and needs recomposition.

These examples are NOT shipped to the Claude marketplace or skills.sh — they are not listed in `.claude-plugin/plugin.json` or `marketplace.json`. They live here purely as a test fixture and as documentation of the frontmatter contract.

## Adding your own primary skill (production)

For a real primary skill, drop a SKILL.md under `skills/<name>/` (not here), then add it to `.claude-plugin/plugin.json` `skills[]`. The same tooling applies — just without the env vars.
