import { expect, it } from "vitest";

import { acpPicaSupport } from "@/backend/agents/acp/AcpPicaSupport";

it("exposes the chat-only extensions", () => {
  expect(Object.keys(acpPicaSupport).sort()).toEqual([
    "createRequests",
    "decideHelperPermission",
    "registerRequests",
  ]);
  expect(typeof acpPicaSupport.createRequests).toBe("function");
});
