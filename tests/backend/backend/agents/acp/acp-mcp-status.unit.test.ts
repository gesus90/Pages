import { expect, it } from "vitest";

import { readMcpServerStatus } from "@/backend/agents/acp/AcpMcpStatus";

const TEXT = [
  "**Connected**",
  "- `github`",
  "**Needs Authentication**",
  "* `pages` (oauth)",
  "**Unlisted group**",
  "- `other`",
  "plain line",
].join("\n");

it("reads the group a server is listed under", () => {
  expect(readMcpServerStatus(TEXT, "github")).toBe("connected");
});

it("counts a server that needs authentication as failed", () => {
  expect(readMcpServerStatus(TEXT, "pages")).toBe("failed");
});

it("reads an unknown group heading as unknown", () => {
  expect(readMcpServerStatus(TEXT, "other")).toBe("unknown");
});

it("reads a server the text does not list as unknown", () => {
  expect(readMcpServerStatus(TEXT, "missing")).toBe("unknown");
});
