import { expect, it } from "vitest";

import { AGENT_WRITE_TOOLS } from "../../../src/tools/agents.ts";

it.each(["create_agent", "update_agent"])(
  "offers structured ticket parameters and their field syntax through %s",
  (name) => {
    const entry = AGENT_WRITE_TOOLS.find(({ tool }) => tool.name === name);
    expect(entry?.tool.inputSchema).toMatchObject({
      properties: {
        parameters: {
          items: {
            properties: {
              type: { enum: ["text", "ticket", "workspace", "wiki"] },
            },
          },
        },
      },
    });
    expect(entry?.tool.description).toContain("{{parameter.description}}");
    expect(entry?.tool.description).toContain("{{parameter.assets}}");
  },
);
