// Tests for tools/audit.mjs pure-shape behaviors. We avoid fetching the
// real package.json or skills tree by setting SKILL_X_SKILLS_DIR to a
// per-test sandbox before importing.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const SANDBOX = await mkdtemp(join(tmpdir(), "skill-x-audit-"));
await mkdir(join(SANDBOX, "skills"), { recursive: true });
await mkdir(join(SANDBOX, "manifest"), { recursive: true });
process.env.SKILL_X_SKILLS_DIR = join(SANDBOX, "skills");
process.env.SKILL_X_MANIFEST_DIR = join(SANDBOX, "manifest");

const { audit, renderMarkdown } = await import("./audit.mjs");
const lib = await import("./lib.mjs");

after(() => rm(SANDBOX, { recursive: true, force: true }));

async function fixture(name, fm, body = "# fixture\n") {
  await mkdir(join(lib.SKILLS_DIR, name), { recursive: true });
  await lib.writeSkill(name, fm, body);
}

test("audit: renderMarkdown produces a valid markdown report shell", () => {
  const md = renderMarkdown({
    audited_at: "2026-05-14T00:00:00Z",
    stack_signals: [],
    active_skills: [],
    integration_opportunities: [],
    contradictions: [],
    weak_composes: [],
    stale_primaries: [],
    expired_validity: [],
  });
  assert.match(md, /# skill-audit report/);
  assert.match(md, /\| Integration opportunities \| 0 \|/);
});

test("audit: detects weak compose", async () => {
  await fixture("audit-parent-a", {
    name: "audit-parent-a",
    description: "Parent A primary fixture for audit weak-compose test path.",
    sources: [{ kind: "npm", package: "audit-pkg-a" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-01T00:00:00Z",
    upstream_hash: null,
  });
  await fixture("audit-derived-thin", {
    name: "audit-derived-thin",
    description: "Thin derived skill — only one variant, audit should flag.",
    sources: [],
    composed_from: ["audit-parent-a"],
    compose_rule: "rule",
    compose_variants: [{ id: "only", summary: "only", weakest_link: "n/a" }],
    selected: "only",
    selection_rationale: "no alternatives explored",
    last_synced: "2026-05-01T00:00:00Z",
    upstream_hash: null,
  });
  const report = await audit();
  assert.equal(report.weak_composes.length >= 1, true);
  assert.equal(
    report.weak_composes.some((w) => w.skill === "audit-derived-thin"),
    true,
  );

  // cleanup so other tests don't see these
  await rm(join(lib.SKILLS_DIR, "audit-parent-a"), { recursive: true, force: true });
  await rm(join(lib.SKILLS_DIR, "audit-derived-thin"), { recursive: true, force: true });
});

test("audit: detects expired validity", async () => {
  await fixture("audit-expired", {
    name: "audit-expired",
    description: "Expired-validity primary fixture for audit aging-out test.",
    sources: [{ kind: "npm", package: "audit-pkg-x" }],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-01T00:00:00Z",
    upstream_hash: null,
    valid_until: "2020-01-01T00:00:00Z",
  });
  const report = await audit();
  assert.equal(
    report.expired_validity.some((e) => e.skill === "audit-expired"),
    true,
  );
  await rm(join(lib.SKILLS_DIR, "audit-expired"), { recursive: true, force: true });
});

test("audit: detects trigger contradictions when ≥2 skills share a matcher", async () => {
  // build a temporary package.json so the stack scan succeeds without crashing
  await writeFile(
    join(SANDBOX, "package.json"),
    JSON.stringify({ name: "x", dependencies: {} }),
    "utf8",
  );

  await fixture("audit-trig-a", {
    name: "audit-trig-a",
    description: "Trigger A skill for contradiction detection test path here.",
    sources: [],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-01T00:00:00Z",
    upstream_hash: null,
    triggers: [{ kind: "package", value: "react" }],
  });
  await fixture("audit-trig-b", {
    name: "audit-trig-b",
    description: "Trigger B skill claims same matcher as A; should collide.",
    sources: [],
    composed_from: [],
    compose_rule: "",
    last_synced: "2026-05-01T00:00:00Z",
    upstream_hash: null,
    triggers: [{ kind: "package", value: "react" }],
  });
  const report = await audit();
  assert.equal(
    report.contradictions.some(
      (c) =>
        c.matcher === "package:react" &&
        c.skills.includes("audit-trig-a") &&
        c.skills.includes("audit-trig-b"),
    ),
    true,
  );
  await rm(join(lib.SKILLS_DIR, "audit-trig-a"), { recursive: true, force: true });
  await rm(join(lib.SKILLS_DIR, "audit-trig-b"), { recursive: true, force: true });
});
