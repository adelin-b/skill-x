#!/usr/bin/env node
// skill-x MCP server. See AGENTS.md and PUBLISH.md for the install snippet.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkAll as composeCheckAll } from "./compose.mjs";
import { listSkills, readSkill, SKILL_NAME_RE } from "./lib.mjs";
import { check as syncCheck, commit as syncCommit } from "./sync.mjs";

// readSkill / writeSkill / readManifest all join `skill` into filesystem paths.
// A caller could send "../../etc/passwd"; bind the Zod schema to the same
// kebab-case regex skill-validate uses (length-capped via `SKILL_NAME_RE`).
const SkillName = z
  .string()
  .regex(
    SKILL_NAME_RE,
    "skill name must be kebab-case (lowercase letter, digits/hyphens, max 64 chars)",
  );

function classifySkill(fm) {
  if ((fm.composed_from ?? []).length > 0) return "derived";
  if ((fm.sources ?? []).length > 0) return "primary";
  return "procedural"; // see AGENTS.md Constraints: empty sources = no upstream.
}

const server = new McpServer({
  name: "skill-x",
  version: "0.1.0",
});

server.registerTool(
  "list_skills",
  {
    title: "List skills",
    description:
      "List every skill in this repo with its kind (primary or derived), last_synced timestamp, and source/lineage info.",
    inputSchema: {},
  },
  async () => {
    const names = await listSkills();
    const rows = await Promise.all(
      names.map(async (name) => {
        const skill = await readSkill(name);
        const fm = skill.frontmatter;
        const sources = (fm.sources || []).map((s) => `${s.kind}:${s.package || s.url || s.repo}`);
        const lineage = fm.composed_from || [];
        return {
          name,
          kind: classifySkill(fm),
          last_synced: fm.last_synced || null,
          upstream_hash: fm.upstream_hash || null,
          sources,
          composed_from: lineage,
        };
      }),
    );
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
    };
  },
);

server.registerTool(
  "check_drift",
  {
    title: "Check upstream drift",
    description:
      "Detect whether a primary skill's recorded upstream_hash still matches its upstream signals (npm version, docs hash, changelog hash, github release hash). Returns drift status and the live vs. recorded hashes.",
    inputSchema: {
      skill: SkillName.optional().describe(
        "Skill name to check. Omit to check all primary skills.",
      ),
    },
  },
  async ({ skill }) => {
    const names = skill ? [skill] : await listSkills();
    const results = await Promise.all(names.map((name) => syncCheck(name)));
    const report = results.filter((r) => r !== null);
    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
  },
);

server.registerTool(
  "check_compose",
  {
    title: "Check derived-skill staleness",
    description:
      "Detect whether a derived skill's parents have been re-synced more recently than the derived skill itself. A stale derived skill needs re-composition under its compose_rule.",
    inputSchema: {
      skill: SkillName.optional().describe(
        "Derived skill name to check. Omit to check all derived skills.",
      ),
    },
  },
  async ({ skill }) => {
    const results = await composeCheckAll(skill ?? null);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  },
);

server.registerTool(
  "stamp_skill",
  {
    title: "Stamp skill after regeneration",
    description:
      "Update a skill's last_synced and upstream_hash from its cached manifest. Call this only after the SKILL.md body has been regenerated to match the latest upstream content. Idempotent — running twice is harmless.",
    inputSchema: {
      skill: SkillName.describe("Skill name to stamp."),
    },
  },
  async ({ skill }) => {
    await syncCommit(skill);
    return {
      content: [{ type: "text", text: `stamped ${skill}` }],
    };
  },
);

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (err) {
  console.error("skill-x MCP server failed to start:", err);
  process.exit(1);
}
