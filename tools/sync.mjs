#!/usr/bin/env node
// skill-sync: detect drift between cached upstream signals and current skill.
//
// Usage:
//   node tools/sync.mjs                 # check all skills, print drift report
//   node tools/sync.mjs --skill zod-base
//   node tools/sync.mjs --check         # exit 1 if any skill has drifted (CI mode)
//
// This script does NOT regenerate SKILL.md content — that requires an LLM and
// is performed by the `skill-sync` skill in Claude Code, which reads this
// script's report and rewrites the affected SKILL.md bodies. Once the body is
// regenerated, the skill calls `node tools/sync.mjs --commit <skill>` to
// stamp the new last_synced/upstream_hash.

import { argv, exit } from "node:process";
import {
  combineHashes,
  fetchSignal,
  listSkills,
  nowIso,
  readManifest,
  readSkill,
  writeManifest,
  writeSkill,
} from "./lib.mjs";

async function main() {
  const args = parseArgs(argv.slice(2));
  const targets = args.skill ? [args.skill] : await listSkills();

  if (args.commit) {
    if (!args.skill) {
      console.error("--commit requires --skill <name>");
      exit(2);
    }
    await commit(args.skill);
    return;
  }

  const drifted = [];
  const errored = [];
  for (const name of targets) {
    const result = await check(name);
    if (!result) continue; // skill has no `sources` — skip
    if (result.drifted) drifted.push(result);
    if (result.errors.length > 0) errored.push(result);
    printResult(result);
  }

  if (args.check) {
    const failures = [];
    if (drifted.length > 0) failures.push(`${drifted.length} drifted`);
    if (errored.length > 0 && !args.allowErrors)
      failures.push(`${errored.length} with fetch errors`);
    if (failures.length > 0) {
      console.error(`\n${failures.join(", ")}.`);
      exit(1);
    }
  }
}

export async function check(name) {
  const skill = await readSkill(name);
  const sources = skill.frontmatter.sources;
  if (!sources || sources.length === 0) return null;

  const signals = [];
  const errors = [];
  for (const src of sources) {
    try {
      signals.push(await fetchSignal(src));
    } catch (err) {
      const sig = { kind: src.kind, id: src.package || src.url || src.repo, error: String(err) };
      signals.push(sig);
      errors.push(sig);
    }
  }

  // Live hash is computed only from successful signals so a transient fetch
  // failure does not flap drift detection. The presence of errors is reported
  // separately via the result's `errors` array.
  const goodHashes = signals.filter((s) => s.hash).map((s) => s.hash);
  const liveHash = goodHashes.length > 0 ? combineHashes(goodHashes) : null;
  const recordedHash = skill.frontmatter.upstream_hash;
  const drifted = liveHash !== null && liveHash !== recordedHash;

  await writeManifest(name, {
    skill: name,
    checked_at: nowIso(),
    signals,
    live_hash: liveHash,
    recorded_hash: recordedHash,
    drifted,
    errors,
  });

  return { name, drifted, signals, liveHash, recordedHash, errors };
}

export async function commit(name) {
  const manifest = await readManifest(name);
  if (!manifest) throw new Error(`No manifest for ${name} — run sync first.`);
  const skill = await readSkill(name);
  skill.frontmatter.last_synced = nowIso();
  skill.frontmatter.upstream_hash = manifest.live_hash;
  const path = await writeSkill(name, skill.frontmatter, skill.body);
  console.log(`stamped ${path}`);
  console.log(`  upstream_hash: ${manifest.live_hash}`);
  console.log(`  last_synced:   ${skill.frontmatter.last_synced}`);
}

function printResult({ name, drifted, signals, liveHash, recordedHash, errors }) {
  const tag = errors.length > 0 ? "ERROR" : drifted ? "DRIFT" : "ok   ";
  console.log(`[${tag}] ${name}`);
  if (drifted || errors.length > 0) {
    console.log(`        recorded: ${recordedHash || "<none>"}`);
    console.log(`        live:     ${liveHash || "<unavailable>"}`);
    for (const s of signals) {
      const v = s.version ? ` v${s.version}` : "";
      const e = s.error ? ` ERROR: ${s.error}` : "";
      console.log(`        - ${s.kind}:${s.id}${v}${e}`);
    }
  }
}

function parseArgs(argv) {
  const out = { check: false, commit: false, skill: null, allowErrors: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--commit") out.commit = true;
    else if (a === "--skill") out.skill = argv[++i];
    else if (a === "--allow-errors") out.allowErrors = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

// Only run main() when invoked as a script, not when imported.
import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
