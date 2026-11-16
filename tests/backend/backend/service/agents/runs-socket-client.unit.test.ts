import { EventEmitter } from "node:events";

import { beforeEach, expect, it, vi } from "vitest";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { SwarmCall } from "@/backend/service/agents/swarm/SwarmRegistry";

const boundary = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({
  request: boundary.request,
  createServer: vi.fn(),
}));

import {
  callRunApi,
  callRunsSwarm,
  notifyRuns,
  queryRunOwnership,
  runsSocketPath,
} from "@/backend/service/agents/runs/RunsSocket";

function respond(body: string): void {
  boundary.request.mockImplementation((options, callback) => {
    expect(options.method).toBe("POST");
    const call = new EventEmitter();
    Object.assign(call, {
      end: () => {
        const response = new EventEmitter();
        Object.assign(response, { setEncoding: vi.fn() });
        callback(response);
        response.emit("data", body);
        response.emit("end");
      },
      destroy: (error: Error) => call.emit("error", error),
    });
    return call;
  });
}

beforeEach(() => vi.resetAllMocks());

it("calls the run API and translates dispatch failures", async () => {
  expect(runsSocketPath("/data/pages.db")).toBe(
    "/data/runs-control/engine.sock",
  );
  respond(JSON.stringify({ version: 1, ok: true, result: { value: 42 } }));
  expect(await callRunApi("socket", { operation: "read" })).toEqual({
    value: 42,
  });
  for (const error of [
    "dispatch_paused",
    "dispatch_cancelled",
    "unavailable",
  ]) {
    respond(JSON.stringify({ version: 1, ok: false, error }));
    await expect(callRunApi("socket", {})).rejects.toThrow();
  }
});

it("validates ownership and swarm replies", async () => {
  respond(JSON.stringify({ version: 1, ok: true, result: { active: true } }));
  expect(await queryRunOwnership("socket", "run")).toBe(true);
  respond(JSON.stringify({ version: 1, ok: false, error: "unavailable" }));
  await expect(queryRunOwnership("socket", "run")).rejects.toThrow();
  const call = partial<SwarmCall>({
    runId: "run",
    stepId: "step",
    operation: "read",
    parameters: {},
  });
  respond(
    JSON.stringify({ version: 1, ok: true, result: { result: "answer" } }),
  );
  expect(await callRunsSwarm("socket", call)).toBe("answer");
  respond(
    JSON.stringify({ version: 1, ok: true, result: { refused: "FORBIDDEN" } }),
  );
  await expect(callRunsSwarm("socket", call)).rejects.toThrow();
});

it("treats malformed or unavailable wake replies as a failed best-effort notification", async () => {
  respond(JSON.stringify({ version: 1, accepted: true }));
  expect(await notifyRuns("socket")).toBe(true);
  respond(JSON.stringify({ version: 2, accepted: true }));
  expect(await notifyRuns("socket")).toBe(false);
  respond("not JSON");
  expect(await notifyRuns("socket")).toBe(false);
});
