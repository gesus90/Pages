import { expect, it } from "vitest";

import {
  AGENT_EXTENSION_READ_OPERATIONS,
  AGENT_EXTENSION_WRITE_OPERATIONS,
} from "@/definition/AgentExtensions";

it("keeps the extension reads and writes apart", () => {
  const writes: readonly string[] = AGENT_EXTENSION_WRITE_OPERATIONS;

  expect(AGENT_EXTENSION_READ_OPERATIONS).toContain("tags.list");
  expect(writes).toContain("ticket.setTags");
  expect(
    AGENT_EXTENSION_READ_OPERATIONS.filter((read) => writes.includes(read)),
  ).toEqual([]);
});
