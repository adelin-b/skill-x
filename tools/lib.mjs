// Shared helpers for skill-sync and skill-compose.
// Pure Node — no deps. Frontmatter parsing is deliberately minimal:
// supports the small YAML subset we use (scalars, ISO dates, lists, nested
// dashed lists). Anything richer should fail loud rather than misparse.

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Roots are overridable via env vars so `examples/` can be linted, synced,
// and composed without touching the production `skills/` tree. `path.resolve`
// honors absolute env values; relative values resolve against REPO_ROOT.
//   SKILL_X_SKILLS_DIR=examples/skills npm run sync
//   SKILL_X_MANIFEST_DIR=examples/manifest npm run sync
export const SKILLS_DIR = process.env.SKILL_X_SKILLS_DIR
  ? resolve(REPO_ROOT, process.env.SKILL_X_SKILLS_DIR)
  : join(REPO_ROOT, "skills");
export const MANIFEST_DIR = process.env.SKILL_X_MANIFEST_DIR
  ? resolve(REPO_ROOT, process.env.SKILL_X_MANIFEST_DIR)
  : join(REPO_ROOT, "manifest");

// Agent Skills spec: kebab-case, must start with a letter, max 64 chars.
// Shared between MCP Zod schema and skill-validate to avoid drift.
export const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export async function readSkill(skillName) {
  const path = join(SKILLS_DIR, skillName, "SKILL.md");
  const raw = await readFile(path, "utf8");
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`No frontmatter in ${path}`);
  return { path, frontmatter: parseYaml(m[1]), body: m[2], raw };
}

export async function writeSkill(skillName, frontmatter, body) {
  const path = join(SKILLS_DIR, skillName, "SKILL.md");
  const yaml = stringifyYaml(frontmatter);
  const out = `---\n${yaml}---\n\n${body.replace(/^\n+/, "")}`;
  await writeFile(path, out, "utf8");
  return path;
}

export async function listSkills() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

// --- minimal YAML ---

function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, value: root, key: null }];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) {
      i++;
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.slice(indent);

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (trimmed.startsWith("- ")) {
      // list item
      if (!Array.isArray(parent)) {
        throw new Error(`Unexpected list item under non-list: ${line}`);
      }
      const itemBody = trimmed.slice(2);
      if (itemBody.includes(":")) {
        const obj = {};
        parent.push(obj);
        const [k, ...rest] = itemBody.split(":");
        const v = rest.join(":").trim();
        if (v) obj[k.trim()] = parseScalar(v);
        // Subsequent keys for this object live at indent > itemIndent.
        // Push the obj at the *item's* indent so the standard pop rule
        // (`>=`) keeps it active for any deeper line and discards it on
        // a sibling list item or a dedent.
        stack.push({ indent, value: obj, key: null });
      } else {
        parent.push(parseScalar(itemBody));
      }
      i++;
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) throw new Error(`Bad YAML line: ${line}`);
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();

    if (value === "|" || value === ">") {
      // block scalar — collect indented continuation lines
      const block = [];
      let j = i + 1;
      let blockIndent = -1;
      while (j < lines.length) {
        const ln = lines[j];
        if (!ln.trim()) {
          block.push("");
          j++;
          continue;
        }
        const li = ln.match(/^ */)[0].length;
        if (li <= indent) break;
        if (blockIndent < 0) blockIndent = li;
        block.push(ln.slice(blockIndent));
        j++;
      }
      // trim trailing blank lines
      while (block.length && block[block.length - 1] === "") block.pop();
      parent[key] = value === "|" ? `${block.join("\n")}\n` : block.join(" ");
      i = j;
      continue;
    }

    if (!value) {
      // container — peek next non-blank line to decide list vs object
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const next = lines[j];
      const isList = next && next.match(/^ */)[0].length > indent && next.trim().startsWith("- ");
      const container = isList ? [] : {};
      parent[key] = container;
      stack.push({ indent, value: container, key });
    } else {
      parent[key] = parseScalar(value);
    }
    i++;
  }
  return root;
}

function parseScalar(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  if (s === "[]") return [];
  if (s === "{}") return {};
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d+\.\d+$/.test(s)) return Number(s);
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1);
  }
  return s;
}

function stringifyYaml(obj, indent = 0) {
  const pad = " ".repeat(indent);
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      out += `${pad}${k}: ~\n`;
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        out += `${pad}${k}: []\n`;
      } else {
        out += `${pad}${k}:\n`;
        for (const item of v) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const entries = Object.entries(item);
            if (entries.length === 0) {
              out += `${pad}  - {}\n`;
              continue;
            }
            const [first, ...rest] = entries;
            out += `${pad}  - ${first[0]}: ${formatScalar(first[1])}\n`;
            for (const [ek, ev] of rest) {
              out += `${pad}    ${ek}: ${formatScalar(ev)}\n`;
            }
          } else {
            out += `${pad}  - ${formatScalar(item)}\n`;
          }
        }
      }
    } else if (typeof v === "object") {
      out += `${pad}${k}:\n${stringifyYaml(v, indent + 2)}`;
    } else if (typeof v === "string" && v.includes("\n")) {
      // Multi-line strings: emit as block-scalar `|` so newlines round-trip.
      out += `${pad}${k}: |\n`;
      const childPad = " ".repeat(indent + 2);
      const trimmed = v.endsWith("\n") ? v.slice(0, -1) : v;
      for (const line of trimmed.split("\n")) {
        out += `${childPad}${line}\n`;
      }
    } else {
      out += `${pad}${k}: ${formatScalar(v)}\n`;
    }
  }
  return out;
}

// YAML 1.2 reserves several leading characters and any string containing
// flow-style punctuation needs quoting. Default to quoting; emit bare only
// when the value is a "plain scalar" that round-trips safely.
const BARE_SCALAR_RE = /^[A-Za-z_][A-Za-z0-9_./@:+-]*$/;

function formatScalar(v) {
  if (v === null || v === undefined) return "~";
  if (typeof v === "string") {
    if (v === "" || !BARE_SCALAR_RE.test(v)) return JSON.stringify(v);
    return v;
  }
  return String(v);
}

// --- hashing ---

export function sha256(input) {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

export function combineHashes(parts) {
  const sorted = [...parts].sort();
  return sha256(sorted.join("\n"));
}

// --- upstream signals ---

export async function fetchSignal(source) {
  if (source.kind === "npm") return fetchNpmSignal(source);
  if (source.kind === "docs") return fetchUrlSignal(source.url);
  if (source.kind === "changelog") return fetchUrlSignal(source.url);
  if (source.kind === "github-release") return fetchGithubReleaseSignal(source);
  throw new Error(`Unknown source kind: ${source.kind}`);
}

async function fetchNpmSignal({ package: pkg }) {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
  if (!res.ok) throw new Error(`npm registry ${res.status} for ${pkg}`);
  const json = await res.json();
  return {
    kind: "npm",
    id: pkg,
    version: json.version,
    hash: sha256(JSON.stringify({ version: json.version, dist: json.dist?.shasum })),
  };
}

async function fetchUrlSignal(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
  const body = await res.text();
  return { kind: "url", id: url, hash: sha256(body) };
}

async function fetchGithubReleaseSignal({ repo }) {
  const headers = { Accept: "application/vnd.github+json" };
  // GitHub anonymous API is 60 req/hr/IP — auth bumps to 5000.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (!res.ok) throw new Error(`github releases ${res.status} for ${repo}`);
  const json = await res.json();
  return {
    kind: "github-release",
    id: repo,
    version: json.tag_name,
    hash: sha256(JSON.stringify({ tag: json.tag_name, body: json.body })),
  };
}

// --- manifest cache ---

export async function readManifest(skillName) {
  const path = join(MANIFEST_DIR, `${skillName}.json`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function writeManifest(skillName, data) {
  const path = join(MANIFEST_DIR, `${skillName}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return path;
}

export function nowIso() {
  return new Date().toISOString();
}
