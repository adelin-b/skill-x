// Tests for tools/hook-sync-on-pkg.mjs filter logic.

import assert from "node:assert/strict";
import { test } from "node:test";

import { extractFilePath, shouldRunSync } from "./hook-sync-on-pkg.mjs";

test("extractFilePath: Claude tool_input.file_path", () => {
  assert.equal(
    extractFilePath({ tool_input: { file_path: "/x/package.json" } }),
    "/x/package.json",
  );
});

test("extractFilePath: camelCase fallback", () => {
  assert.equal(extractFilePath({ tool_input: { filePath: "/x/package.json" } }), "/x/package.json");
});

test("extractFilePath: returns null for empty payload", () => {
  assert.equal(extractFilePath(null), null);
  assert.equal(extractFilePath({}), null);
});

test("shouldRunSync: returns true for package.json POSIX path", () => {
  const stdin = JSON.stringify({ tool_input: { file_path: "/abs/project/package.json" } });
  assert.equal(shouldRunSync(stdin), true);
});

test("shouldRunSync: returns true for package.json Windows path", () => {
  const stdin = JSON.stringify({ tool_input: { file_path: "C:\\proj\\package.json" } });
  assert.equal(shouldRunSync(stdin), true);
});

test("shouldRunSync: returns false for non-package file", () => {
  const stdin = JSON.stringify({ tool_input: { file_path: "/abs/project/src/index.ts" } });
  assert.equal(shouldRunSync(stdin), false);
});

test("shouldRunSync: returns false for empty / non-JSON stdin", () => {
  assert.equal(shouldRunSync(""), false);
  assert.equal(shouldRunSync("   "), false);
  assert.equal(shouldRunSync("not json"), false);
});

test("shouldRunSync: returns false when file_path missing", () => {
  const stdin = JSON.stringify({ tool_input: { foo: "bar" } });
  assert.equal(shouldRunSync(stdin), false);
});

test("shouldRunSync: must end with package.json (not just contain)", () => {
  const stdin = JSON.stringify({ tool_input: { file_path: "/x/package.json.bak" } });
  assert.equal(shouldRunSync(stdin), false);
});
