import { expect, it, vi } from "vitest";

import { decideAcpSessionPermission } from "@/backend/agents/acp/AcpSessionPermission";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpSessionContext } from "@/backend/agents/acp/AcpSessionContracts";
import type { AcpSessionState } from "@/backend/agents/acp/AcpEvents";
import type { AcpPermissionDecision } from "@/backend/agents/acp/AcpDriver";

type PermissionContext = Parameters<typeof decideAcpSessionPermission>[0];
const DECISION: AcpPermissionDecision = {
  outcome: { outcome: "selected", optionId: "allow" },
  isDenied: false,
};
const REQUEST = partial<RequestPermissionRequest>({});
const STATE = partial<AcpSessionState>({ permissionDenials: 0, events: [] });

it("answers plan permissions from the profile without loading Pica support", () => {
  const decide = vi.fn(() => DECISION);
  const context = partial<PermissionContext>({
    profile: { mode: "read_only", decide },
  });
  expect(decideAcpSessionPermission(context, STATE, REQUEST)).toEqual({
    outcome: DECISION.outcome,
  });
  expect(decide).toHaveBeenCalledWith(REQUEST);
});

it("keeps read-only chat helper permissions on the injected exact-call policy", () => {
  const decide = vi.fn();
  const decideHelperPermission = vi.fn(() => DECISION);
  const context = partial<PermissionContext>({
    profile: { mode: "read_only", decide },
    listener: { picaHelper: () => "/synthetic/helper" },
    picaSupport: partial<NonNullable<AcpSessionContext["picaSupport"]>>({
      decideHelperPermission,
    }),
  });
  expect(decideAcpSessionPermission(context, STATE, REQUEST)).toEqual({
    outcome: DECISION.outcome,
  });
  expect(decide).not.toHaveBeenCalled();
  expect(decideHelperPermission).toHaveBeenCalledWith(
    REQUEST,
    "/synthetic/helper",
  );
});

it("refuses a chat helper when its permission support is missing", () => {
  const decide = vi.fn();
  const context = partial<PermissionContext>({
    profile: { mode: "read_only", decide },
    listener: { picaHelper: () => "/synthetic/helper" },
  });
  expect(() => decideAcpSessionPermission(context, STATE, REQUEST)).toThrow(
    "support is missing",
  );
  expect(decide).not.toHaveBeenCalled();
});
