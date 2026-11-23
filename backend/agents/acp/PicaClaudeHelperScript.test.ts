import { expect, it } from "vitest";

import { picaHelperScript } from "@/backend/agents/acp/PicaClaudeHelperScript";

it("starts the script with the runtime line", () => {
  const script = picaHelperScript("/usr/bin/node");
  expect(script.startsWith("#!/usr/bin/node\n")).toBe(true);
  expect(script).toContain("TOOL_HTTP_");
});
