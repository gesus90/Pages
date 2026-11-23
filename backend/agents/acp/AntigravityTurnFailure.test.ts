import { expect, it } from "vitest";

import { readAntigravityTurnFailure } from "@/backend/agents/acp/AntigravityTurnFailure";

const QUOTA_HEAD =
  "Usage Limit Reached\n\nYou have reached your current quota for this period.";

it("reads a quota report without a reset as a quota failure", () => {
  expect(readAntigravityTurnFailure(QUOTA_HEAD, false)).toEqual({
    code: "provider_quota_exhausted",
    providerFailure: { code: "provider_quota_exhausted", resetAt: null },
  });
});

it("reads a relative reset as a quota failure without a moment", () => {
  const text = `${QUOTA_HEAD} Your limit will reset in 2 hours.`;
  expect(readAntigravityTurnFailure(text, false)?.providerFailure).toEqual({
    code: "provider_quota_exhausted",
    resetAt: null,
  });
});

it("reads an absolute reset moment", () => {
  const text = `answer\n${QUOTA_HEAD} Your limit will reset on 1 Jan 2030 10:00:00 UTC.`;
  expect(readAntigravityTurnFailure(text, false)?.providerFailure).toEqual({
    code: "provider_quota_exhausted",
    resetAt: "2030-01-01T10:00:00.000Z",
  });
});

it("reads an MCP load failure only when Pages supplied an MCP server", () => {
  const text = "The MCP server 'pages' failed to initialize: boom";
  expect(readAntigravityTurnFailure(text, true)).toEqual({
    code: "plan_mcp_unavailable",
    providerFailure: null,
  });
  expect(readAntigravityTurnFailure(text, false)).toBeNull();
});

it("reads an execution error and a lost connection as a session failure", () => {
  const failed = {
    code: "antigravity_acp_session_failed",
    providerFailure: null,
  };
  expect(readAntigravityTurnFailure("Agent execution error: x", false)).toEqual(
    failed,
  );
  expect(
    readAntigravityTurnFailure(
      "Agent connection was lost and could not be re-established: x",
      false,
    ),
  ).toEqual(failed);
});

it("ignores ordinary model text", () => {
  expect(readAntigravityTurnFailure("All done.", true)).toBeNull();
});
