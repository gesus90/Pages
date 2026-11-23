import { expect, it } from "vitest";

import {
  acpSessionSecrets,
  createAcpRedactor,
  redactAcpJsonLine,
} from "@/backend/agents/cli/CliAcpRedaction";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { AcpLaunch } from "@/backend/agents/acp/AcpLaunch";
import type { CliCredentialAccess } from "@/backend/agents/cli/CliContracts";
import type { CliGitHubAccess } from "@/backend/agents/cli/CliGitHubCredentials";

/** Casts a partial stand-in to the type the code under test expects. */
function fake<T>(value: object): T {
  return value as T;
}

function mask(secret: string): (text: string) => string {
  return (text) => text.replaceAll(secret, "<masked>");
}

it("masks credentials, GitHub access and explicit tokens in order", () => {
  const redact = createAcpRedactor({
    credentials: fake<CliCredentialAccess>({ redact: mask("key-1") }),
    github: fake<CliGitHubAccess>({ redact: mask("gh-1") }),
    tokens: ["tok-1", undefined, ""],
  });
  expect(redact("key-1 gh-1 tok-1 plain")).toBe(
    "<masked> <masked> [redacted] plain",
  );
});

it("leaves text untouched without credentials, GitHub access or tokens", () => {
  const redact = createAcpRedactor({ github: null, tokens: [] });
  expect(redact("plain")).toBe("plain");
});

it("collects the step token, server password and chat server secrets", () => {
  const input = fake<AgentPlanSessionInput>({
    mcp: { token: "step-token" },
    chat: {
      mcpServers: [
        { name: "http", url: "u", headers: [{ name: "a", value: "header-1" }] },
        {
          name: "stdio",
          command: "c",
          args: [],
          env: [
            { name: "A", value: "1" },
            { name: "B", value: "long-secret-value" },
          ],
        },
        { name: "bare" },
      ],
    },
  });
  const launch = fake<AcpLaunch>({
    environment: { OPENCODE_SERVER_PASSWORD: "server-pass" },
  });
  expect(acpSessionSecrets(input, launch)).toEqual([
    "step-token",
    "server-pass",
    "header-1",
    "long-secret-value",
  ]);
});

it("reports absent values for a session without MCP or chat", () => {
  const secrets = acpSessionSecrets(
    fake<AgentPlanSessionInput>({}),
    fake<AcpLaunch>({ environment: {} }),
  );
  expect(secrets).toEqual([undefined, undefined]);
});

it("redacts every string inside a parsed JSON line and keeps its framing", () => {
  const redact = mask("secret");
  const line = JSON.stringify({
    a: "secret",
    list: ["secret", 1, null, { deep: "x secret" }],
    flag: true,
  });
  expect(redactAcpJsonLine(line, redact)).toBe(
    JSON.stringify({
      a: "<masked>",
      list: ["<masked>", 1, null, { deep: "x <masked>" }],
      flag: true,
    }),
  );
  expect(redactAcpJsonLine("null", redact)).toBe("null");
});

it("redacts a line that is not JSON as plain text", () => {
  expect(redactAcpJsonLine("not json secret", mask("secret"))).toBe(
    "not json <masked>",
  );
});
