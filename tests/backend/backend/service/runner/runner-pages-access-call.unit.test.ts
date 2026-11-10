import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { TOOL_ENTRIES } from "@/definition/AgentTools/ToolCatalog";

import {
  CONNECTION_ID,
  REQUEST_ID,
  TOKEN,
  envelope,
  openDefault,
  pagesAccessWorld,
  remoteWith,
  runWith,
} from "./runner-pages-access-harness";

import type { AgentOperationDetails } from "@/definition/PagesAgentOperations";
import type { PagesAccessWorld } from "./runner-pages-access-harness";

const TICKET_ID = "6f1c1c46-95d8-4e13-9f0f-2f3c1ad8b5aa";

let world: PagesAccessWorld;

function toolFor(operation: string): string {
  const entry = TOOL_ENTRIES.find(
    (candidate) => candidate.operation === operation,
  );
  if (!entry) throw new Error(`No tool for ${operation}`);
  return entry.tool.name;
}

function call(
  name: string,
  args: Record<string, unknown> = {},
): Promise<Readonly<Record<string, unknown>>> {
  return world.service.receive(
    CONNECTION_ID,
    envelope({ kind: "call", name, arguments: args }),
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-01T10:00:00.000Z"));
  world = pagesAccessWorld();
  world.issue.mockResolvedValue({
    token: TOKEN,
    expiresAt: Date.now() + 60_000,
  });
  await openDefault(world);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RunnerPagesAccessService tool calls", () => {
  it("runs the operation of a tool with the capability token and audits it", async () => {
    world.api.handle.mockResolvedValue({ result: { title: "Ticket" } });

    const answer = await call(toolFor("projects.read"), {
      projectId: TICKET_ID,
      secret: "never stored",
    });

    expect(world.api.handle).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      operation: "projects.read",
      parameters: { projectId: TICKET_ID, secret: "never stored" },
    });
    expect(answer).toEqual({
      version: 1,
      type: "pages-result",
      requestId: REQUEST_ID,
      ok: true,
      result: { result: { title: "Ticket" } },
    });
    expect(world.evidence()?.events).toEqual([
      {
        at: "2026-05-01T10:00:00.000Z",
        tool: toolFor("projects.read"),
        target: TICKET_ID,
        result: "ok",
      },
    ]);
    expect(JSON.stringify(world.evidence())).not.toContain("never stored");
  });

  it("appends the audit event to the earlier ones", async () => {
    world.api.handle.mockResolvedValue({ result: {} });

    await call(toolFor("projects.read"), { projectId: TICKET_ID });
    await call(toolFor("projects.read"), { projectId: "PAGE-7" });

    expect(world.evidence()?.events.map((event) => event.target)).toEqual([
      TICKET_ID,
      "PAGE-7",
    ]);
  });

  it.each([
    ["a ticket key", { ticketId: "PAGE-12" }, "PAGE-12"],
    ["a ticket uuid", { ticketId: TICKET_ID }, TICKET_ID],
    [
      "a page id before a project",
      { pageId: TICKET_ID, projectId: "PAGE" },
      TICKET_ID,
    ],
    [
      "a ticket id before a page",
      { ticketId: "PAGE-3", pageId: TICKET_ID },
      "PAGE-3",
    ],
    ["free text", { ticketId: "../etc/passwd" }, null],
    ["a lowercase key", { projectId: "page-1" }, null],
    ["a key that is too long", { ticketId: "A".repeat(17) + "-1" }, null],
    ["a non-string id", { ticketId: 12 }, null],
    ["no id at all", {}, null],
  ])("audits the target for %s", async (name, args, target) => {
    world.api.handle.mockResolvedValue({ result: {} });

    await call(toolFor("projects.read"), args);

    expect(world.evidence()?.events[0].target).toBe(target);
  });

  it("refuses an unknown tool without an API call or an audit event", async () => {
    await expect(call("no_such_tool")).resolves.toMatchObject({
      ok: false,
      error: "plan_mcp_unavailable",
    });

    expect(world.api.handle).not.toHaveBeenCalled();
    expect(world.evidence()?.events).toEqual([]);
  });
});

describe("RunnerPagesAccessService tool call failures", () => {
  it("turns a forbidden operation into a denied tool result", async () => {
    world.api.handle.mockRejectedValue(new AgentOperationError("FORBIDDEN"));

    const answer = await call(toolFor("projects.read"), { projectId: "PAGE" });

    expect(answer).toMatchObject({
      ok: true,
      result: { isError: true, code: "FORBIDDEN" },
    });
    expect(world.evidence()?.events[0].result).toBe("denied");
  });

  it("reports the code of any other business failure as failed", async () => {
    world.api.handle.mockRejectedValue(new AgentOperationError("NOT_FOUND"));

    const answer = await call(toolFor("projects.read"));

    expect(answer).toMatchObject({
      ok: true,
      result: { isError: true, code: "NOT_FOUND" },
    });
    expect(answer).not.toHaveProperty("result.details");
    expect(world.evidence()?.events[0].result).toBe("failed");
  });

  it("hides the message of an unexpected failure behind FORBIDDEN", async () => {
    world.api.handle.mockRejectedValue(new Error("database password leaked"));

    const answer = await call(toolFor("projects.read"));

    expect(answer).toMatchObject({
      ok: true,
      result: { isError: true, code: "FORBIDDEN" },
    });
    expect(JSON.stringify(answer)).not.toContain("leaked");
    expect(world.evidence()?.events[0].result).toBe("failed");
  });

  it.each(["run.step.report", "run.step.progress"])(
    "tells the agent what to correct for a refused %s",
    async (operation) => {
      const details: AgentOperationDetails = {
        reason: "step_report_invalid",
        problems: ["todo T1 is open"],
      };
      world.api.handle.mockRejectedValue(
        new AgentOperationError("INVALID_REQUEST", details),
      );

      const answer = await call(toolFor(operation));

      expect(answer).toMatchObject({
        result: { isError: true, code: "INVALID_REQUEST", details },
      });
    },
  );

  it("does not expose details of other refused operations", async () => {
    world.api.handle.mockRejectedValue(
      new AgentOperationError("INVALID_REQUEST", {
        reason: "step_report_invalid",
        problems: ["hidden"],
      }),
    );

    const answer = await call(toolFor("projects.read"));

    expect(answer).not.toHaveProperty("result.details");
  });

  it("fails the request when the step has no attempt to audit under", async () => {
    const noAttempt = pagesAccessWorld();
    noAttempt.issue.mockResolvedValue({
      token: TOKEN,
      expiresAt: Date.now() + 60_000,
    });
    await noAttempt.service.open(
      runWith({ steps: [{ id: "step-1", status: "running" }] }),
      remoteWith(),
      "attempt-1",
    );
    noAttempt.api.handle.mockResolvedValue({ result: {} });

    const answer = await noAttempt.service.receive(
      CONNECTION_ID,
      envelope({
        kind: "call",
        name: toolFor("projects.read"),
        arguments: {},
      }),
    );

    expect(answer).toMatchObject({ ok: false, error: "plan_context_changed" });
    expect(noAttempt.evidence()?.events).toEqual([]);
  });
});

describe("RunnerPagesAccessService prepared uploads", () => {
  it("remembers the name of a prepared upload for later failures", async () => {
    world.api.handle.mockResolvedValue({
      result: { ticket: "t".repeat(43) },
    });

    await call(toolFor("assets.upload.prepare"), {
      fileName: "../report final.pdf",
      operationId: "operation-1",
    });
    world.api.verify.mockResolvedValue({ run: { reach: "read" } });
    const upload = await world.service.receive(
      CONNECTION_ID,
      envelope({
        kind: "upload",
        ticket: "t".repeat(43),
        offset: 0,
        base64: "",
        done: true,
        digest: "0".repeat(64),
      }),
    );

    expect(upload).toMatchObject({
      ok: false,
      error: "plan_access_denied",
      assetFailure: {
        id: "output",
        name: "report final.pdf",
        cause: "plan_access_denied",
      },
    });
  });

  it("keeps the default output name when the prepared upload gives none", async () => {
    world.api.handle.mockResolvedValue({ result: { ticket: "u".repeat(43) } });
    await call(toolFor("assets.upload.prepare"), {});
    world.api.verify.mockResolvedValue({ run: { reach: "read" } });

    const upload = await world.service.receive(
      CONNECTION_ID,
      envelope({
        kind: "upload",
        ticket: "u".repeat(43),
        offset: 0,
        base64: "",
        done: true,
        digest: "0".repeat(64),
      }),
    );

    expect(upload).toMatchObject({
      assetFailure: { id: "output", name: "output" },
    });
  });

  it.each([
    ["no ticket in the result", { result: {} }],
    ["a non-string ticket", { result: { ticket: 5 } }],
    ["no result at all", { error: "x" }],
  ])("does not remember an upload for %s", async (name, response) => {
    world.api.handle.mockResolvedValue(response);
    await call(toolFor("assets.upload.prepare"), { fileName: "a.txt" });
    world.api.verify.mockResolvedValue({ run: { reach: "read" } });

    const upload = await world.service.receive(
      CONNECTION_ID,
      envelope({
        kind: "upload",
        ticket: "t".repeat(43),
        offset: 0,
        base64: "",
        done: true,
        digest: "0".repeat(64),
      }),
    );

    expect(upload).toMatchObject({ assetFailure: { name: "output" } });
  });
});
