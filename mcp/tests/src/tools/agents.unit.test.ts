import { describe, expect, it } from "vitest";

import {
  AGENT_READ_TOOLS,
  AGENT_WRITE_TOOLS,
} from "../../../src/tools/agents.ts";
import { PLAN_WRITE_TOOLS } from "../../../src/tools/plans.ts";

const RETIRED_TOOL_NAMES = ["create_agent", "update_agent"] as const;
const PLAN_TOOL_NAMES = ["create_plan", "update_plan"] as const;

describe("AGENT_WRITE_TOOLS", () => {
  it.each(RETIRED_TOOL_NAMES)(
    "retires %s in favor of direct plan nodes",
    (name) => {
      expect(AGENT_WRITE_TOOLS).toEqual([]);
      expect(AGENT_WRITE_TOOLS.map(({ tool }) => tool.name)).not.toContain(
        name,
      );
    },
  );
});

describe("AGENT_READ_TOOLS", () => {
  it("retains the agent and model compatibility reads", () => {
    expect(
      AGENT_READ_TOOLS.map(({ operation, tool }) => [operation, tool.name]),
    ).toEqual([
      ["agents.list", "list_agents"],
      ["agents.read", "read_agent"],
      ["agents.models.list", "list_agent_models"],
    ]);
  });
});

describe("PLAN_WRITE_TOOLS parameter declarations", () => {
  it.each(PLAN_TOOL_NAMES)(
    "offers typed parameter declarations through %s",
    (name) => {
      const tool = PLAN_WRITE_TOOLS.find(
        (entry) => entry.tool.name === name,
      )?.tool;
      // The old agent-write contract moved to node configuration; it also supports numeric values.
      expect(JSON.stringify(tool?.inputSchema)).toContain(
        '"enum":["text","number","ticket","workspace","wiki"]',
      );
      expect(tool?.description).toContain(
        "template.markdown/parameters/directoryParameter/run",
      );
      expect(tool?.description).toContain("explicit connectionId and model");
    },
  );
});
