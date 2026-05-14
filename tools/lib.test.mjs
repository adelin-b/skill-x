// Regression tests for tools/lib.mjs YAML parser. Run with `node --test`.
//
// We point SKILLS_DIR / MANIFEST_DIR at a per-process tmpdir BEFORE importing
// lib.mjs, so fixtures never touch the real `skills/` tree. Stale fixtures
// from a crashed run are impossible because the tmpdir name is unique per
// invocation and cleaned up by `after()` regardless of pass/fail.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const SANDBOX = await mkdtemp(join(tmpdir(), "skill-x-test-"));
await mkdir(join(SANDBOX, "skills"), { recursive: true });
await mkdir(join(SANDBOX, "manifest"), { recursive: true });
process.env.SKILL_X_SKILLS_DIR = join(SANDBOX, "skills");
process.env.SKILL_X_MANIFEST_DIR = join(SANDBOX, "manifest");

// NOTE: lib.mjs reads env at module-load time, so this import must come
// AFTER the env mutation above.
const lib = await import("./lib.mjs");

after(() => rm(SANDBOX, { recursive: true, force: true }));

async function withFixture(t, name, fm, body = "# fixture body\n") {
  const dir = join(lib.SKILLS_DIR, name);
  await mkdir(dir, { recursive: true });
  await lib.writeSkill(name, fm, body);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return name;
}

test("YAML round-trip: list of objects with mixed inline scalars", async (t) => {
  const name = await withFixture(t, "fx-objs", {
    name: "fx-objs",
    description: "fixture",
    sources: [
      { kind: "npm", package: "zod", range: "^3" },
      { kind: "docs", url: "https://zod.dev" },
    ],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-06T19:00:00Z",
    upstream_hash: null,
  });
  const round = await lib.readSkill(name);
  assert.equal(round.frontmatter.name, name);
  assert.deepEqual(round.frontmatter.sources, [
    { kind: "npm", package: "zod", range: "^3" },
    { kind: "docs", url: "https://zod.dev" },
  ]);
  assert.deepEqual(round.frontmatter.composed_from, []);
  assert.equal(round.frontmatter.compose_rule, "");
  assert.equal(round.frontmatter.upstream_hash, null);
});

test("YAML round-trip: composed_from list of strings + block scalar rule", async (t) => {
  const name = await withFixture(t, "fx-block", {
    name: "fx-block",
    description: "fixture",
    sources: [],
    composed_from: ["a", "b"],
    compose_rule: "first line\nsecond line\n",
    last_synced: "2026-05-06T19:00:00Z",
    upstream_hash: "sha256:abc",
  });
  const round = await lib.readSkill(name);
  assert.deepEqual(round.frontmatter.composed_from, ["a", "b"]);
  assert.equal(round.frontmatter.compose_rule, "first line\nsecond line\n");
});

test("env override: SKILLS_DIR follows SKILL_X_SKILLS_DIR", () => {
  assert.equal(lib.SKILLS_DIR, join(SANDBOX, "skills"));
  assert.equal(lib.MANIFEST_DIR, join(SANDBOX, "manifest"));
});

test("hashing: combineHashes is order-independent", () => {
  const a = lib.sha256("a");
  const b = lib.sha256("b");
  assert.equal(lib.combineHashes([a, b]), lib.combineHashes([b, a]));
});

test("nowIso returns a parseable ISO timestamp", () => {
  const ts = lib.nowIso();
  assert.ok(!Number.isNaN(Date.parse(ts)));
});

test("SKILL_NAME_RE accepts kebab-case names of <= 64 chars", () => {
  assert.equal(lib.SKILL_NAME_RE.test("zod-base"), true);
  assert.equal(lib.SKILL_NAME_RE.test("a"), true);
  assert.equal(lib.SKILL_NAME_RE.test("a".repeat(64)), true);
});

test("SKILL_NAME_RE rejects traversal, uppercase, leading digit, > 64 chars", () => {
  assert.equal(lib.SKILL_NAME_RE.test("../etc/passwd"), false);
  assert.equal(lib.SKILL_NAME_RE.test("Foo"), false);
  assert.equal(lib.SKILL_NAME_RE.test("9abc"), false);
  assert.equal(lib.SKILL_NAME_RE.test(""), false);
  assert.equal(lib.SKILL_NAME_RE.test("a".repeat(65)), false);
  assert.equal(lib.SKILL_NAME_RE.test("foo bar"), false);
  assert.equal(lib.SKILL_NAME_RE.test("foo/bar"), false);
});
