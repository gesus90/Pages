import { expect, it, vi } from "vitest";

import { CliIsolationGate } from "@/backend/agents/cli/CliIsolationGate";

import type { CliSessionRequest } from "@/backend/agents/cli/CliContracts";
import type { ClaudePlanSessionHome } from "@/backend/agents/cli/ClaudePlanSessionHome";
import type { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";

const logging = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

function sessionRequest(
  overrides: Partial<CliSessionRequest> = {},
): CliSessionRequest {
  return {
    file: "/synthetic/tool",
    arguments: [],
    provider: "claude_code",
    home: {
      root: "/synthetic/root",
      home: "/synthetic/root/home",
      config: "/synthetic/root/config",
      work: "/synthetic/root/work",
    },
    workingDirectory: "/synthetic/work",
    environment: { KEEP: "1" },
    timeoutMs: 1000,
    signal: new AbortController().signal,
    onLine: () => undefined,
    ...overrides,
  };
}

function isolationOf(
  isolate: (request: CliSessionRequest) => Promise<CliSessionRequest | null>,
): CliPlanIsolation {
  return { isolate } as unknown as CliPlanIsolation;
}

const scopedHome = {
  home: {
    root: "/scoped",
    home: "/scoped/home",
    config: "/scoped/c",
    work: "/scoped/w",
  },
  credential: { source: "/a", target: "/b" },
} as unknown as ClaudePlanSessionHome;

it("returns a request without temporary directory unchanged when no isolation exists", async () => {
  const request = sessionRequest();
  const gate = new CliIsolationGate(null, false);

  expect(await gate.isolateSession(request, null)).toEqual({
    request,
    isIsolated: false,
  });
});

it("adds the temporary environment when no isolation exists", async () => {
  const gate = new CliIsolationGate(null, false);
  const result = await gate.isolateSession(
    sessionRequest({ temporaryDirectory: "/synthetic/tmp" }),
    null,
  );

  expect(result.isIsolated).toBe(false);
  expect(result.request.environment).toMatchObject({
    KEEP: "1",
    TMPDIR: "/synthetic/tmp",
    TMP: "/synthetic/tmp",
  });
});

it("refuses to start without isolation when it is required", async () => {
  const gate = new CliIsolationGate(null, true);

  await expect(
    gate.isolateSession(sessionRequest(), null),
  ).rejects.toMatchObject({ code: "cli_isolation_unavailable" });
});

it("returns the isolated request of a working namespace", async () => {
  const wrapped = sessionRequest({ file: "/wrapped" });
  const gate = new CliIsolationGate(
    isolationOf(async () => wrapped),
    false,
  );

  expect(await gate.isolateSession(sessionRequest(), null)).toEqual({
    request: wrapped,
    isIsolated: true,
  });
});

it("refuses a failing namespace when isolation is required", async () => {
  const gate = new CliIsolationGate(
    isolationOf(async () => null),
    true,
  );

  await expect(
    gate.isolateSession(sessionRequest(), null),
  ).rejects.toMatchObject({ code: "cli_isolation_unavailable" });
});

it("warns once and falls back when the namespace does not work", async () => {
  const gate = new CliIsolationGate(
    isolationOf(async () => null),
    false,
  );

  const first = await gate.isolateSession(sessionRequest(), null);
  const second = await gate.isolateSession(sessionRequest(), null);

  expect(first.isIsolated).toBe(false);
  expect(second.isIsolated).toBe(false);
  expect(logging.logDiagnostic).toHaveBeenCalledTimes(1);
});

it("gives a plan session its scoped home inside a working namespace", async () => {
  const isolate = vi.fn(async (request: CliSessionRequest) => request);
  const gate = new CliIsolationGate(isolationOf(isolate), false);

  const result = await gate.isolateSession(sessionRequest(), scopedHome);

  expect(result.isIsolated).toBe(true);
  expect(isolate).toHaveBeenCalledTimes(1);
  expect(result.request.home).toBe(scopedHome.home);
  expect(result.request.credentialFile).toBe(scopedHome.credential);
});

it("keeps the connection home for a plan session without a namespace", async () => {
  const gate = new CliIsolationGate(null, false);
  const request = sessionRequest();

  const result = await gate.isolateSession(request, scopedHome);

  expect(result).toEqual({ request, isIsolated: false });
});
