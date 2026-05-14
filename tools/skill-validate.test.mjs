// Tests for tools/skill-validate.mjs.
//
// Each test creates a temporary fixture skill so the validator has something
// concrete to read, then asserts the issue set it produces.

import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { SKILLS_DIR, writeSkill } from "./lib.mjs";
import { validate } from "./skill-validate.mjs";

async function withFixture(t, name, frontmatter, body = "# fixture\n") {
  const dir = join(SKILLS_DIR, name);
  await mkdir(dir, { recursive: true });
  await writeSkill(name, frontmatter, body);
  t.after(() => rm(dir, { recursive: true, force: true }));
}

function severities(issues) {
  return issues.map((i) => i.severity).sort();
}

test("validate: clean primary skill passes", async (t) => {
  const name = "test-val-primary";
  await withFixture(t, name, {
    name,
    description: "Primary skill fixture with enough characters in description.",
    sources: [{ kind: "npm", package: "zod", range: "^3" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.deepEqual(issues, [], `unexpected issues: ${JSON.stringify(issues)}`);
});

test("validate: clean derived skill passes", async (t) => {
  const name = "test-val-derived";
  await withFixture(t, name, {
    name,
    description: "Derived skill fixture with enough characters in description.",
    sources: [],
    composed_from: ["a-parent", "b-parent"],
    compose_rule: "use Zod for every Convex validator",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.deepEqual(issues, []);
});

test("validate: rejects bad name and short description", async (t) => {
  const name = "test-val-bad";
  await withFixture(t, name, {
    name: "Bad_Name",
    description: "too short",
    sources: [],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  const msgs = issues.map((i) => i.message).join("\n");
  assert.match(msgs, /kebab-case/);
  assert.match(msgs, /must match directory/);
  assert.match(msgs, /description too short/);
  assert.equal(severities(issues).filter((s) => s === "error").length >= 3, true);
});

test("validate: derived skill missing compose_rule errors", async (t) => {
  const name = "test-val-no-rule";
  await withFixture(t, name, {
    name,
    description: "Derived skill fixture with enough characters in description.",
    sources: [],
    composed_from: ["a-parent"],
    compose_rule: "",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.equal(
    issues.some((i) => i.severity === "error" && /compose_rule/.test(i.message)),
    true,
  );
});

test("validate: skill cannot be both primary and derived", async (t) => {
  const name = "test-val-hybrid";
  await withFixture(t, name, {
    name,
    description: "Hybrid skill fixture with enough characters in description.",
    sources: [{ kind: "npm", package: "zod" }],
    composed_from: ["a-parent"],
    compose_rule: "rule",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.equal(
    issues.some((i) => i.severity === "error" && /both sources/.test(i.message)),
    true,
  );
});

test("validate: unknown source kind rejected", async (t) => {
  const name = "test-val-bad-kind";
  await withFixture(t, name, {
    name,
    description: "Bad-kind fixture with enough characters in description, padding.",
    sources: [{ kind: "ftp", url: "ftp://example.com" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.equal(
    issues.some((i) => i.severity === "error" && /unknown kind/.test(i.message)),
    true,
  );
});

test("validate: malformed upstream_hash warns", async (t) => {
  const name = "test-val-bad-hash";
  await withFixture(t, name, {
    name,
    description: "Bad-hash fixture with enough characters in description, padding.",
    sources: [{ kind: "npm", package: "zod" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-06T00:00:00Z",
    upstream_hash: "not-a-hash",
  });
  const issues = await validate(name);
  assert.equal(
    issues.some((i) => i.severity === "warn" && /upstream_hash/.test(i.message)),
    true,
  );
});

test("validate: unparseable last_synced errors", async (t) => {
  const name = "test-val-bad-ts";
  await withFixture(t, name, {
    name,
    description: "Bad-ts fixture with enough characters in description, padding text.",
    sources: [{ kind: "npm", package: "zod" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "not-a-date",
    upstream_hash: null,
  });
  const issues = await validate(name);
  assert.equal(
    issues.some((i) => i.severity === "error" && /not a parseable ISO/.test(i.message)),
    true,
  );
});
