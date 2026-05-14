// Tests for tools/gen-hooks.mjs pure builders.

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildClaudeHooks, buildCodexYaml, buildGithubWorkflow } from "./gen-hooks.mjs";

const SAMPLE_SPEC = {
  description: "test spec",
  hooks: [
    {
      id: "drift-on-package-edit",
      description: "fires on package.json edit",
      events: ["postToolUse"],
      match: { tool: "Edit|Write|MultiEdit", filePattern: "**/package.json" },
      run: "node tools/hook-sync-on-pkg.mjs",
      blocking: false,
    },
    {
      id: "stale-warn-session-start",
      description: "warns on stale derived skills",
      events: ["sessionStart"],
      run: "node tools/compose.mjs",
      blocking: false,
    },
  ],
};

test("buildClaudeHooks: groups by Claude event name", () => {
  const out = buildClaudeHooks(SAMPLE_SPEC);
  assert.equal(Object.keys(out).sort().join(","), "PostToolUse,SessionStart");
  assert.equal(out.PostToolUse.length, 1);
  assert.equal(out.PostToolUse[0].matcher, "Edit|Write|MultiEdit");
  assert.equal(out.PostToolUse[0].hooks[0].type, "command");
  assert.equal(out.PostToolUse[0].hooks[0].command, "node tools/hook-sync-on-pkg.mjs");
  assert.equal(out.SessionStart[0].matcher, ".*");
});

test("buildClaudeHooks: throws on unknown event names", () => {
  assert.throws(
    () =>
      buildClaudeHooks({
        hooks: [{ id: "x", events: ["unknownEvent"], run: "noop" }],
      }),
    /unknown event/,
  );
});

test("buildClaudeHooks: handles all 7 mapped event names", () => {
  const all = [
    "preToolUse",
    "postToolUse",
    "sessionStart",
    "sessionEnd",
    "userPromptSubmitted",
    "agentStop",
    "subagentStop",
  ];
  const out = buildClaudeHooks({
    hooks: all.map((ev) => ({ id: `h-${ev}`, events: [ev], run: "noop" })),
  });
  assert.equal(Object.keys(out).length, 7);
});

test("buildCodexYaml: contains every hook id and references hooks: header", () => {
  const yaml = buildCodexYaml(SAMPLE_SPEC);
  assert.match(yaml, /^name: skill-x$/m);
  assert.match(yaml, /^hooks:$/m);
  assert.match(yaml, /id: drift-on-package-edit/);
  assert.match(yaml, /id: stale-warn-session-start/);
  assert.match(yaml, /file_pattern: "\*\*\/package\.json"/);
  assert.match(yaml, /run: "node tools\/hook-sync-on-pkg\.mjs"/);
});

test("buildCodexYaml: hook without filePattern omits when: block", () => {
  const yaml = buildCodexYaml({
    description: "no filter",
    hooks: [{ id: "h", description: "d", events: ["sessionStart"], run: "node x" }],
  });
  assert.equal(yaml.includes("when:"), false);
});

test("buildGithubWorkflow: returns a workflow with cron + skill paths", () => {
  const yaml = buildGithubWorkflow();
  assert.match(yaml, /name: skill-x drift check/);
  assert.match(yaml, /cron: "0 6 \* \* \*"/);
  assert.match(yaml, /skills\/\*\*\/SKILL\.md/);
  assert.match(yaml, /node tools\/sync\.mjs --check/);
  assert.match(yaml, /node tools\/compose\.mjs --check/);
});
