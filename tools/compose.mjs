#!/usr/bin/env node
// skill-compose: detect which derived skills need recomposition because one
// of their `composed_from` sources was re-synced more recently than the
// derived skill's own last_synced timestamp.
//
// Usage:
//   node tools/compose.mjs               # report which derived skills are stale
//   node tools/compose.mjs --check       # exit 1 if any derived skill is stale (CI)
//   node tools/compose.mjs --skill convex-with-zod   # report just one
//
// This script does NOT generate SKILL.md content — that's the job of the
// `skill-compose` skill in Claude Code, which reads this report, rewrites the
// derived SKILL.md bodies according to `compose_rule`, then calls
// `node tools/sync.mjs --commit <skill>` to stamp.

import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { listSkills, readSkill } from "./lib.mjs";

export async function checkAll(targetName = null) {
  const all = await listSkills();
  const targets = targetName ? [targetName] : all;

  if (targetName && !all.includes(targetName)) {
    throw new Error(`Unknown skill: ${targetName}. Known: ${all.join(", ") || "<none>"}`);
  }

  const skills = new Map();
  for (const name of all) skills.set(name, await readSkill(name));

  const results = [];
  for (const name of targets) {
    const s = skills.get(name);
    if (!s) continue;
    const lineage = s.frontmatter.composed_from;
    if (!lineage || lineage.length === 0) continue;

    const ownTsResult = parseTs(s.frontmatter.last_synced);
    const newer = [];
    if (ownTsResult.bad) {
      newer.push({ parent: name, reason: "bad-timestamp", value: s.frontmatter.last_synced });
    }
    for (const parentName of lineage) {
      const parent = skills.get(parentName);
      if (!parent) {
        newer.push({ parent: parentName, reason: "missing" });
        continue;
      }
      const parentTsResult = parseTs(parent.frontmatter.last_synced);
      if (parentTsResult.bad) {
        newer.push({
          parent: parentName,
          reason: "bad-timestamp",
          value: parent.frontmatter.last_synced,
        });
        continue;
      }
      if (parentTsResult.value > ownTsResult.value) {
        newer.push({
          parent: parentName,
          parentTs: parentTsResult.value,
          ownTs: ownTsResult.value,
        });
      }
    }

    results.push({ name, lineage, stale: newer.length > 0, newer });
  }
  return results;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const results = await checkAll(args.skill);
  const stale = results.filter((r) => r.stale);
  for (const r of results) printResult(r.name, r.lineage, r.stale, r.newer);

  if (args.check && stale.length > 0) {
    console.error(`\n${stale.length} derived skill(s) stale.`);
    exit(1);
  }
}

// Returns { value, bad } so the caller can distinguish "missing timestamp"
// (treat as epoch — valid, the field is optional) from "unparseable string"
// (loud signal — frontmatter is corrupt).
function parseTs(v) {
  if (!v) return { value: 0, bad: false };
  const t = Date.parse(v);
  if (Number.isFinite(t)) return { value: t, bad: false };
  return { value: 0, bad: true };
}

function printResult(name, lineage, stale, newer) {
  const tag = stale ? "STALE" : "ok   ";
  console.log(`[${tag}] ${name}  (composed_from: ${lineage.join(", ")})`);
  for (const n of newer) {
    if (n.reason === "missing") {
      console.log(`        - ${n.parent}: MISSING`);
    } else if (n.reason === "bad-timestamp") {
      console.log(`        - ${n.parent}: BAD TIMESTAMP (${n.value})`);
    } else {
      console.log(
        `        - ${n.parent}: parent newer (${new Date(n.parentTs).toISOString()} > ${new Date(n.ownTs).toISOString()})`,
      );
    }
  }
}

function parseArgs(argv) {
  const out = { check: false, skill: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") out.check = true;
    else if (a === "--skill") out.skill = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
