import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { READ_TOOLS } from "../../mcp/src/tools/registry";
import { WRITE_TOOLS } from "../../mcp/src/tools/write-registry";

const readme = readFileSync(
  new URL("../../mcp/README.md", import.meta.url),
  "utf8",
);
const section = readme
  .split("## Tickets and milestones (A9.11)")[1]
  ?.split("\n## ")[0];

it("documents every A9.11 tool and its exact operation and required parameters", () => {
  const entries = [...READ_TOOLS, ...WRITE_TOOLS].filter(
    ({ operation }) =>
      operation.startsWith("ticket.") || operation.startsWith("milestone"),
  );
  expect(entries).toHaveLength(15);
  for (const { operation, tool } of entries) {
    expect(section).toContain(`\`${tool.name}\``);
    expect(section).toContain(`\`${operation}\``);
    for (const key of tool.inputSchema.required ?? [])
      expect(section).toContain(`\`${key}\``);
  }
});

it("retains conflict, visibility, rights, sorting, replay and Pages synchronization contracts with the completed coverage status", () => {
  const content = section?.replace(/\s+/g, " ");
  for (const contract of [
    '"nothing" is `null`',
    "A status\n  change keeps the position value of the ticket",
    "the call succeeds with `changed: false`",
    "A parent you cannot see reads as\n  `null` and stays when you name none",
    "an account that only writes tickets gets\n  `FORBIDDEN`",
    "published to GitHub follows the Pages setting of its project",
    "nothing is published\n  before the change is committed",
    "A refused\n  call stores nothing",
    "The stored result is shown again only while its ticket or\n  project is still visible",
    "100% statements, branches, functions and lines per executable file",
    "contracts have no executable coverage counters",
  ])
    expect(content).toContain(contract.replace(/\s+/g, " "));
  expect(section).not.toContain("remain open");
});
