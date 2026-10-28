import { expect, it } from "vitest";

import {
  AGENT_CONNECTION_SCOPE_KINDS,
  isAgentConnectionScopeKind,
  isAgentConnectionScopeMode,
} from "@/definition/AgentConnectionScope";

it("accepts the stored scope modes only", () => {
  expect(isAgentConnectionScopeMode("global")).toBe(true);
  expect(isAgentConnectionScopeMode("restricted")).toBe(true);
  expect(isAgentConnectionScopeMode("open")).toBe(false);
});

it("accepts directory identities but rejects a system function", () => {
  for (const kind of AGENT_CONNECTION_SCOPE_KINDS)
    expect(isAgentConnectionScopeKind(kind)).toBe(true);
  expect(isAgentConnectionScopeKind("function")).toBe(false);
});
