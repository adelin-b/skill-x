#!/usr/bin/env node
// Hook wrapper that reads agent hook stdin (Claude Code / Codex format),
// inspects tool_input.file_path, and only runs sync.mjs when a package.json
// is being edited. Without this guard, the hook fires on every Edit and
// hammers the npm/docs/changelog network every keystroke.
//
// Claude hook input shape:
//   {
//     "tool_input": { "file_path": "/abs/path/to/file" },
//     "tool_name": "Edit"
//   }
//
// Codex's exact shape is best-effort; this script reads either object.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { exit, stdin } from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SYNC_SCRIPT = join(SCRIPT_DIR, "sync.mjs");

const TARGET_BASENAME = "package.json";

export function extractFilePath(payload) {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.tool_input?.file_path ||
    payload.tool_input?.filePath ||
    payload.input?.file_path ||
    payload.file_path ||
    null
  );
}

export function shouldRunSync(rawStdin, { warn = () => {} } = {}) {
  if (!rawStdin?.trim()) return false;
  let payload;
  try {
    payload = JSON.parse(rawStdin);
  } catch (err) {
    warn(`hook-sync-on-pkg: malformed stdin payload, skipping (${err.message})`);
    return false;
  }
  const filePath = extractFilePath(payload);
  if (!filePath) return false;
  // Dual check handles Windows path separators.
  return filePath.endsWith(`/${TARGET_BASENAME}`) || filePath.endsWith(`\\${TARGET_BASENAME}`);
}

async function readStdin() {
  let raw = "";
  for await (const chunk of stdin) raw += chunk;
  return raw;
}

async function main() {
  const raw = await readStdin();
  if (!shouldRunSync(raw, { warn: (m) => console.error(m) })) exit(0);

  // Run sync; bubble exit code so the agent surfaces failures.
  // Ignore stdin so the buffered hook payload doesn't leak into sync.mjs if it
  // ever starts reading stdin.
  const proc = spawn(process.execPath, [SYNC_SCRIPT], { stdio: ["ignore", "inherit", "inherit"] });
  proc.on("exit", (code) => exit(code ?? 0));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
