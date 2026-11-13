import { sendLocalCommand } from "@/backend/agents/local/LocalSessionTransport";
import { classifyAgentRunErrorCode } from "@/backend/service/agents/diagnosis/AgentRunErrorClassifier";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { AgentError } from "@/backend/error/AgentErrors";
import { closeCliSession } from "@/backend/agents/cli/CliSessionCloseout";
import { safeLogMetadata } from "@/backend/logging/LogRedaction";
import { localClosedSchema } from "@/backend/agents/local/LocalSessionContracts";

import { CLOSED } from "./local-owner-session-fixture";
import { controlOwner, httpBoundary } from "./local-control-harness";
import { MANIFEST } from "./local-sessions-fixture";
import {
  reportedTurn,
  runClosedStep,
} from "../../service/agents/page333-closeout-fixture";

vi.mock("node:http", async () => {
  const harness = await import("./local-control-harness");
  return { createServer: harness.createServer, request: harness.request };
});
vi.mock("@/backend/logging/Logger", async () => ({
  logEvent: (await import("./local-control-harness")).httpBoundary.logEvent,
}));

it("returns 200 and confirmed exit zero when the CLI exits before close, and replays the result", async () => {
  const process = {
    exited: Promise.resolve({
      code: 0,
      signal: null,
      errorCode: null,
      stderrTail: "",
    }),
    endInput: vi.fn(),
    cancel: vi.fn(),
  };
  await process.exited;
  const closed = await closeCliSession(
    process,
    "native",
    undefined,
    "pid_namespace",
  );
  const close = vi.fn(async () => closed);
  const control = await controlOwner({ close });
  const first = await control({ kind: "close" });
  const second = await control({ kind: "close" });
  expect(first).toEqual({
    closed: { ...closed, exit: { code: 0, signal: null }, isConfirmed: true },
  });
  expect(second).toEqual(first);
  expect(
    httpBoundary.responses.slice(1).map((response) => response.status),
  ).toEqual([200, 200]);
  expect(process.cancel).not.toHaveBeenCalled();
  const node = await runClosedStep({
    turn: Promise.resolve(reportedTurn()),
    close: async () =>
      z
        .object({ closed: localClosedSchema })
        .parse(await control({ kind: "close" })).closed,
  });
  expect(node.result).toMatchObject({
    status: "succeeded",
    error: null,
    session: { closeout: "confirmed", exit: { code: 0, signal: null } },
  });
});

it.each([
  {
    failure: new AgentError("plan_history_unavailable"),
    code: "plan_history_unavailable",
  },
  {
    failure: new Error("owner-private-answer"),
    code: "internal",
  },
])(
  "returns a safe 409 diagnosis and logs command, status and $code",
  async ({ failure, code }) => {
    const control = await controlOwner({
      close: async () => {
        throw failure;
      },
    });
    await expect(control({ kind: "close" })).rejects.toMatchObject({
      code: "plan_local_control_failed",
      detail: code,
    });
    expect(httpBoundary.responses.at(-1)).toMatchObject({
      status: 409,
      body: JSON.stringify({ error: code }),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    });
    expect(httpBoundary.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "local.control.rejected",
        metadata: { kind: "close", code },
      }),
    );
    expect(httpBoundary.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "local.control.failed",
        metadata: { operation: "close", statusCode: 409, code },
      }),
    );
    expect(
      safeLogMetadata({ operation: "close", statusCode: 409, code }),
    ).toMatchObject({ operation: "close", statusCode: 409, code });
  },
);

it.each([401, 403])("keeps %s as plan_local_owner_unverified", async (status) => {
  const control = await controlOwner({ close: async () => CLOSED });
  httpBoundary.reply = { status, body: "" };
  await expect(control({ kind: "close" })).rejects.toMatchObject({
    code: "plan_local_owner_unverified",
  });
});

it.each(["malformed", "unknown", "extra"])(
  "never exposes credentials or prompt/answer content from a %s owner error",
  async (kind) => {
    const control = await controlOwner({ close: async () => CLOSED });
    const secrets = [
      "bearer-token-sentinel",
      MANIFEST.capability,
      "private-prompt-sentinel",
      "private-answer-sentinel",
      "77777777-7777-4777-8777-777777777777",
    ];
    const payload = {
      error: secrets.join(" "),
      token: secrets[0],
      capability: secrets[1],
      prompt: secrets[2],
      answer: secrets[3],
    };
    if (kind === "extra") payload.error = "plan_history_unavailable";
    httpBoundary.reply = {
      status: 409,
      body: kind === "malformed" ? secrets.join(" ") : JSON.stringify(payload),
    };
    const error: unknown = await control({
      kind: "steer",
      prompt: "private-prompt-sentinel",
      commandId: "88888888-8888-4888-8888-888888888888",
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AgentError);
    const diagnostics =
      JSON.stringify(httpBoundary.logEvent.mock.calls) + String(error);
    for (const secret of secrets) expect(diagnostics).not.toContain(secret);
    expect(diagnostics).not.toContain("capability");
  },
);

it("omits upstream exception text and credentials from close errors and diagnostics", async () => {
  const secrets = [
    MANIFEST.capability,
    "bearer-token-sentinel",
    "private-prompt-sentinel",
    "private-answer-sentinel",
  ];
  const control = await controlOwner({
    close: async () => {
      throw new Error(secrets.join(" "));
    },
  });
  const failure: unknown = await control({ kind: "close" }).catch(
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AgentError);
  const diagnostics =
    JSON.stringify(httpBoundary.logEvent.mock.calls) +
    String(failure) +
    JSON.stringify(httpBoundary.responses);
  for (const secret of secrets) expect(diagnostics).not.toContain(secret);
});

it("reports stale attachment without dispatching native close or exposing the attachment", async () => {
  const close = vi.fn(async () => CLOSED);
  await controlOwner({ close });
  await expect(sendLocalCommand(MANIFEST, { kind: "close" }, "private-stale-attachment")).rejects.toMatchObject({ code: "plan_local_control_failed", detail: "stale_attachment" });
  expect(close).not.toHaveBeenCalled();
  expect(httpBoundary.responses.at(-1)?.body).toBe(JSON.stringify({ error: "stale_attachment" }));
  expect(JSON.stringify(httpBoundary.logEvent.mock.calls)).not.toContain("private-stale-attachment");
});

it("reports native_cleanup_unconfirmed when a release cannot prove cleanup", async () => {
  const control = await controlOwner({ close: async () => ({ ...CLOSED, isConfirmed: false }) });
  await expect(control({ kind: "release" })).rejects.toMatchObject({ code: "plan_local_control_failed", detail: "native_cleanup_unconfirmed" });
  expect(httpBoundary.responses.at(-1)?.body).toBe(JSON.stringify({ error: "native_cleanup_unconfirmed" }));
});

it("bounds an oversized owner body and retains the HTTP status without logging any response content", async () => {
  const control = await controlOwner({ close: async () => CLOSED });
  httpBoundary.reply = { status: 502, body: "private-answer-sentinel".repeat(100_000) };
  await expect(control({ kind: "close" })).rejects.toMatchObject({ code: "plan_local_control_failed", detail: "internal" });
  expect(httpBoundary.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "local.control.failed", metadata: { operation: "close", statusCode: 502, code: "internal" } }));
  expect(JSON.stringify(httpBoundary.logEvent.mock.calls)).not.toContain("private-answer-sentinel");
  expect(classifyAgentRunErrorCode("plan_local_control_failed")).toBe("process_crash");
});

it("refuses arbitrary regex-shaped response content as an owner diagnosis", async () => {
  const control = await controlOwner({ close: async () => CLOSED });
  httpBoundary.reply = { status: 409, body: JSON.stringify({ error: "private_answer_sentinel" }) };
  await expect(control({ kind: "close" })).rejects.toMatchObject({ code: "plan_local_control_failed", detail: "internal" });
  expect(JSON.stringify(httpBoundary.logEvent.mock.calls)).not.toContain("private_answer_sentinel");
});
