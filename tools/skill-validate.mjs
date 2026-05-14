#!/usr/bin/env node
// skill-validate: lint SKILL.md files against the Agent Skills standard
// plus skill-x extensions.
//
// Checks:
//   - name: required, kebab-case, 1-64 chars
//   - description: required, 20-500 chars
//   - name matches parent directory
//   - primary skills have non-empty sources[]
//   - derived skills have non-empty composed_from[] AND compose_rule
//   - timestamps parse as ISO when present
//
// Exit 0 = clean. Exit 1 = errors. Use --strict to also fail on warnings.

import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";
import { listSkills, readSkill, SKILL_NAME_RE } from "./lib.mjs";

const NAME_RE = SKILL_NAME_RE;

export async function validate(name, knownSkills = null) {
  const issues = [];
  let skill;
  try {
    skill = await readSkill(name);
  } catch (err) {
    return [{ severity: "error", message: `failed to read SKILL.md: ${err.message}` }];
  }
  const fm = skill.frontmatter;

  if (!fm.name) {
    issues.push({ severity: "error", message: "frontmatter.name missing" });
  } else {
    if (!NAME_RE.test(fm.name)) {
      issues.push({
        severity: "error",
        message: `frontmatter.name "${fm.name}" must be kebab-case, 1-64 chars`,
      });
    }
    if (fm.name !== name) {
      issues.push({
        severity: "error",
        message: `frontmatter.name "${fm.name}" must match directory "${name}"`,
      });
    }
  }

  if (!fm.description) {
    issues.push({ severity: "error", message: "frontmatter.description missing" });
  } else {
    const len = fm.description.length;
    if (len < 20)
      issues.push({
        severity: "error",
        message: `description too short (${len} chars; minimum 20)`,
      });
    if (len > 500)
      issues.push({
        severity: "warn",
        message: `description long (${len} chars; recommended max 500)`,
      });
  }

  const sources = fm.sources || [];
  const composedFrom = fm.composed_from || [];
  const isDerived = composedFrom.length > 0;
  const isPrimary = sources.length > 0;

  if (isPrimary && isDerived) {
    issues.push({
      severity: "error",
      message: "skill cannot have both sources[] (primary) and composed_from[] (derived)",
    });
  }
  if (isDerived) {
    if (!fm.compose_rule || fm.compose_rule.trim().length === 0) {
      issues.push({ severity: "error", message: "derived skill must have non-empty compose_rule" });
    }
    for (const parent of composedFrom) {
      if (!NAME_RE.test(parent)) {
        issues.push({
          severity: "error",
          message: `composed_from entry "${parent}" not kebab-case`,
        });
        continue;
      }
      if (knownSkills && !knownSkills.includes(parent)) {
        issues.push({
          severity: "error",
          message: `composed_from parent "${parent}" not found in skills directory`,
        });
      }
    }

    // Reasoning contract: a derived skill is a decision; the alternatives
    // it considered must be persisted so a future reader can see what was
    // rejected and why.
    const variants = fm.compose_variants || [];
    if (variants.length < 2) {
      issues.push({
        severity: "error",
        message: `derived skill must have ≥2 compose_variants (found ${variants.length}); ≥3 recommended`,
      });
    } else if (variants.length < 3) {
      issues.push({
        severity: "warn",
        message: `derived skill has ${variants.length} compose_variants; ≥3 recommended for a meaningful Pareto front`,
      });
    }
    const ids = new Set();
    for (const v of variants) {
      if (!v.id || !NAME_RE.test(v.id)) {
        issues.push({
          severity: "error",
          message: `compose_variants[].id "${v.id}" must be kebab-case`,
        });
      } else if (ids.has(v.id)) {
        issues.push({ severity: "error", message: `compose_variants[].id "${v.id}" duplicated` });
      } else {
        ids.add(v.id);
      }
      if (!v.summary)
        issues.push({ severity: "error", message: `variant "${v.id}" missing summary` });
      if (!v.weakest_link)
        issues.push({ severity: "warn", message: `variant "${v.id}" missing weakest_link` });
    }
    if (variants.length >= 2) {
      if (!fm.selected) {
        issues.push({
          severity: "error",
          message: "derived skill must declare selected variant id",
        });
      } else if (!ids.has(fm.selected)) {
        issues.push({
          severity: "error",
          message: `selected "${fm.selected}" does not match any compose_variants[].id`,
        });
      }
      if (!fm.selection_rationale || fm.selection_rationale.trim().length === 0) {
        issues.push({
          severity: "error",
          message: "selection_rationale required when ≥2 variants exist",
        });
      }
    }
  }
  if (isPrimary) {
    for (const src of sources) {
      if (!src.kind) {
        issues.push({ severity: "error", message: "sources entry missing kind" });
        continue;
      }
      if (!["npm", "docs", "changelog", "github-release"].includes(src.kind)) {
        issues.push({ severity: "error", message: `sources entry has unknown kind: ${src.kind}` });
      }
      if (src.kind === "npm" && !src.package)
        issues.push({ severity: "error", message: "npm source missing package" });
      if ((src.kind === "docs" || src.kind === "changelog") && !src.url)
        issues.push({ severity: "error", message: `${src.kind} source missing url` });
      if (src.kind === "github-release" && !src.repo)
        issues.push({ severity: "error", message: "github-release source missing repo" });
    }
  }

  if (fm.last_synced && !Number.isFinite(Date.parse(fm.last_synced))) {
    issues.push({
      severity: "error",
      message: `last_synced "${fm.last_synced}" is not a parseable ISO timestamp`,
    });
  }

  if (fm.valid_until && !Number.isFinite(Date.parse(fm.valid_until))) {
    issues.push({
      severity: "error",
      message: `valid_until "${fm.valid_until}" is not a parseable ISO timestamp`,
    });
  }

  if (
    fm.upstream_hash &&
    fm.upstream_hash !== null &&
    !/^sha256:[0-9a-f]{64}$/.test(fm.upstream_hash)
  ) {
    issues.push({
      severity: "warn",
      message: `upstream_hash "${fm.upstream_hash}" does not match sha256:<hex64>`,
    });
  }

  return issues;
}

async function main() {
  const args = parseArgs(argv.slice(2));
  const known = await listSkills();
  const targets = args.skill ? [args.skill] : known;

  if (args.skill && !known.includes(args.skill)) {
    console.error(`Unknown skill: ${args.skill}. Known: ${known.join(", ") || "<none>"}`);
    exit(2);
  }

  let errors = 0;
  let warnings = 0;

  for (const name of targets) {
    const issues = await validate(name, known);
    if (issues.length === 0) {
      console.log(`[ok    ] ${name}`);
      continue;
    }
    for (const issue of issues) {
      const tag = issue.severity === "error" ? "ERROR " : "WARN  ";
      console.log(`[${tag}] ${name}: ${issue.message}`);
      if (issue.severity === "error") errors++;
      else warnings++;
    }
  }

  const fail = errors > 0 || (args.strict && warnings > 0);
  if (fail) {
    console.error(`\n${errors} error(s), ${warnings} warning(s).`);
    exit(1);
  }
  console.log(`\nclean — ${errors} error(s), ${warnings} warning(s).`);
}

function parseArgs(argv) {
  const out = { strict: false, skill: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") out.strict = true;
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
