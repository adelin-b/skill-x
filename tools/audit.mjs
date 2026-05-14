#!/usr/bin/env node

// skill-audit: scan every SKILL.md in this repo + the project's package.json
// and surface contradictions, integration opportunities, weak composes, and
// stale primaries. Procedural backbone for the `skill-audit` skill — the
// skill itself interprets the JSON and proposes recommendations.
//
// Usage:
//   node tools/audit.mjs                # human report on stdout
//   node tools/audit.mjs --json         # machine report on stdout
//   node tools/audit.mjs --write        # write .skill-x/audit.{json,md}
//   node tools/audit.mjs --check        # exit 1 on errors (CI gate)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import { listSkills, nowIso, REPO_ROOT, readSkill } from "./lib.mjs";

const STALE_DAYS = 90;

export async function audit() {
  const names = await listSkills();
  const skills = new Map();
  for (const name of names) skills.set(name, await readSkill(name));

  const stack = await readStack();

  const report = {
    audited_at: nowIso(),
    stack_signals: stack.signals,
    active_skills: names,
    integration_opportunities: findIntegrationOpportunities(skills, stack),
    contradictions: findContradictions(skills),
    weak_composes: findWeakComposes(skills),
    stale_primaries: findStalePrimaries(skills, STALE_DAYS),
    expired_validity: findExpiredValidity(skills),
  };

  return report;
}

async function readStack() {
  // npm-only stack signal for now; extensible to tsconfig, framework configs.
  try {
    const raw = await readFile(join(REPO_ROOT, "..", "package.json"), "utf8").catch(() =>
      readFile(join(REPO_ROOT, "package.json"), "utf8"),
    );
    const pkg = JSON.parse(raw);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return {
      signals: Object.entries(deps).map(([name, range]) => `${name}@${range}`),
      packages: new Set(Object.keys(deps)),
    };
  } catch {
    return { signals: [], packages: new Set() };
  }
}

function findIntegrationOpportunities(skills, stack) {
  const opportunities = [];
  const primaryByPkg = new Map();

  for (const [name, skill] of skills) {
    const sources = skill.frontmatter.sources || [];
    for (const src of sources) {
      if (src.kind === "npm" && src.package) {
        if (!primaryByPkg.has(src.package)) primaryByPkg.set(src.package, []);
        primaryByPkg.get(src.package).push(name);
      }
    }
  }

  const present = [...primaryByPkg.entries()]
    .filter(([pkg]) => stack.packages.has(pkg))
    .flatMap(([, names]) => names);

  if (present.length < 2) return opportunities;

  // For each pair of primary skills active in the stack, check whether a
  // derived skill already composes them. If not, opportunity.
  const derivedLineages = new Set();
  for (const [, skill] of skills) {
    const lineage = skill.frontmatter.composed_from || [];
    if (lineage.length >= 2) derivedLineages.add([...lineage].sort().join("+"));
  }

  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const pair = [present[i], present[j]].sort();
      const key = pair.join("+");
      if (!derivedLineages.has(key)) {
        opportunities.push({
          kind: "integration-opportunity",
          parents: pair,
          reason:
            "both primary skills are active in the project's package.json but no derived skill composes them",
          suggestion: `compose ${pair.join(" + ")} into a derived skill via skill-compose`,
        });
      }
    }
  }
  return opportunities;
}

function findContradictions(skills) {
  // Triggers can collide across skills if both declare overlapping
  // `triggers[].kind` and the same matcher value. Today only file-glob and
  // package matchers are checked; prompt-keyword matchers are advisory.
  const out = [];
  const byMatcher = new Map();
  for (const [name, skill] of skills) {
    const triggers = skill.frontmatter.triggers || [];
    for (const t of triggers) {
      if (!t.kind || !t.value) continue;
      const key = `${t.kind}:${t.value}`;
      if (!byMatcher.has(key)) byMatcher.set(key, []);
      byMatcher.get(key).push(name);
    }
  }
  for (const [key, owners] of byMatcher) {
    if (owners.length > 1) {
      out.push({
        kind: "contradiction-candidate",
        matcher: key,
        skills: owners,
        reason:
          "more than one skill claims the same trigger; if their advice differs, fire-order is non-deterministic",
        suggestion: `compose them into a derived skill that resolves the conflict, OR narrow each skill's triggers[] to exclude the overlap`,
      });
    }
  }
  return out;
}

function findWeakComposes(skills) {
  const out = [];
  for (const [name, skill] of skills) {
    const lineage = skill.frontmatter.composed_from || [];
    if (lineage.length === 0) continue;
    const variants = skill.frontmatter.compose_variants || [];
    if (variants.length < 2) {
      out.push({
        kind: "weak-compose",
        skill: name,
        variants_count: variants.length,
        reason:
          "derived skill has fewer than 2 explored composition variants — no Pareto front possible",
        suggestion: "re-run skill-compose, force exploration of ≥3 variants of different kind",
      });
    }
  }
  return out;
}

function findStalePrimaries(skills, maxDays) {
  const out = [];
  const now = Date.now();
  for (const [name, skill] of skills) {
    const sources = skill.frontmatter.sources || [];
    if (sources.length === 0) continue;
    const ts = Date.parse(skill.frontmatter.last_synced || "");
    if (!Number.isFinite(ts)) continue;
    const ageDays = Math.floor((now - ts) / 86400000);
    if (ageDays > maxDays) {
      out.push({
        kind: "stale-primary",
        skill: name,
        last_synced: skill.frontmatter.last_synced,
        age_days: ageDays,
        reason: `primary skill last synced ${ageDays}d ago (> ${maxDays}d budget)`,
        suggestion: "run skill-sync to refresh upstream signals and regenerate body if drifted",
      });
    }
  }
  return out;
}

function findExpiredValidity(skills) {
  const out = [];
  const now = Date.now();
  for (const [name, skill] of skills) {
    const validUntil = skill.frontmatter.valid_until;
    if (!validUntil) continue;
    const ts = Date.parse(validUntil);
    if (Number.isFinite(ts) && ts < now) {
      out.push({
        kind: "expired-validity",
        skill: name,
        valid_until: validUntil,
        reason: "skill's reasoning has reached its valid_until date",
        suggestion:
          "re-evaluate the chosen variant; either renew valid_until with fresh evidence or recompose",
      });
    }
  }
  return out;
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# skill-audit report`);
  lines.push(``);
  lines.push(
    `Audited at \`${report.audited_at}\`. Stack signals: ${report.stack_signals.length}. Active skills: ${report.active_skills.length}.`,
  );

  const totals = [
    ["Integration opportunities", report.integration_opportunities.length],
    ["Contradictions", report.contradictions.length],
    ["Weak composes", report.weak_composes.length],
    ["Stale primaries", report.stale_primaries.length],
    ["Expired validity", report.expired_validity.length],
  ];
  lines.push(``);
  lines.push(`| Finding | Count |`);
  lines.push(`|---------|-------|`);
  for (const [label, n] of totals) lines.push(`| ${label} | ${n} |`);

  for (const [title, key] of [
    ["Integration opportunities", "integration_opportunities"],
    ["Contradictions", "contradictions"],
    ["Weak composes", "weak_composes"],
    ["Stale primaries", "stale_primaries"],
    ["Expired validity", "expired_validity"],
  ]) {
    const items = report[key];
    if (items.length === 0) continue;
    lines.push(``);
    lines.push(`## ${title}`);
    for (const it of items) {
      lines.push(``);
      lines.push(`- **${it.kind}** — ${it.reason}`);
      lines.push(`  - Suggestion: ${it.suggestion}`);
      const detail = Object.entries(it).filter(
        ([k]) => !["kind", "reason", "suggestion"].includes(k),
      );
      for (const [k, v] of detail)
        lines.push(`  - ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const report = await audit();

  if (args.write) {
    const dir = join(REPO_ROOT, ".skill-x");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(join(dir, "audit.md"), renderMarkdown(report), "utf8");
    console.log(`wrote .skill-x/audit.json + audit.md`);
  } else if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderMarkdown(report));
  }

  if (args.check) {
    const blockers = report.contradictions.length + report.weak_composes.length;
    if (blockers > 0) {
      console.error(`\n${blockers} blocking finding(s) (contradictions + weak composes).`);
      exit(1);
    }
  }
}

function parseArgs(argv) {
  const out = { json: false, write: false, check: false };
  for (const a of argv) {
    if (a === "--json") out.json = true;
    else if (a === "--write") out.write = true;
    else if (a === "--check") out.check = true;
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
