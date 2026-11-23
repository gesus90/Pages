import { expect, it } from "vitest";

import {
  approvePermission,
  refusePermission,
  selectPermissionOption,
} from "@/backend/agents/acp/AcpPermissions";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";

function request(
  ...kinds: RequestPermissionRequest["options"][number]["kind"][]
): RequestPermissionRequest {
  return {
    sessionId: "s",
    toolCall: { toolCallId: "t" },
    options: kinds.map((kind) => ({ optionId: kind, name: kind, kind })),
  };
}

it("selects the first kind that is offered", () => {
  expect(
    selectPermissionOption(request("allow_always"), [
      "allow_once",
      "allow_always",
    ]),
  ).toEqual({ outcome: "selected", optionId: "allow_always" });
});

it("cancels when no kind is offered", () => {
  expect(
    selectPermissionOption(request("reject_once"), ["allow_once"]),
  ).toEqual({
    outcome: "cancelled",
  });
});

it("approves without denial", () => {
  expect(approvePermission(request("allow_once"))).toEqual({
    outcome: { outcome: "selected", optionId: "allow_once" },
    isDenied: false,
  });
});

it("refuses with denial", () => {
  expect(refusePermission(request("reject_always"))).toEqual({
    outcome: { outcome: "selected", optionId: "reject_always" },
    isDenied: true,
  });
});
