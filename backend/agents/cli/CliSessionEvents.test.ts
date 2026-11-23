import { expect, it, vi } from "vitest";

import {
  createCliSessionState,
  noteSessionEvent,
  readCliSessionLine,
} from "./CliSessionEvents";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

function read(
  event: unknown,
  state = createCliSessionState(),
): ReturnType<typeof readCliSessionLine> {
  return readCliSessionLine("opencode", JSON.stringify(event), state);
}

it("creates an empty state", () => {
  expect(createCliSessionState()).toEqual({
    sessionId: null,
    text: "",
    isTurnComplete: false,
    hasFailed: false,
    permissionDenials: 0,
    effective: {},
    events: [],
  });
});

it("shortens events, collapses whitespace and keeps the newest sixty", () => {
  const events: string[] = [];
  noteSessionEvent(events, `a \n\t b ${"x".repeat(300)}`);
  expect(events[0]).toHaveLength(200);
  expect(events[0]?.startsWith("a b x")).toBe(true);
  for (let index = 0; index < 70; index += 1)
    noteSessionEvent(events, `line ${index}`);
  expect(events).toHaveLength(60);
  expect(events.at(-1)).toBe("line 69");
});

it("ignores a line that is no JSON and logs it", () => {
  const state = createCliSessionState();
  expect(readCliSessionLine("opencode", "diagnostic", state)).toEqual({});
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliSessionEvents",
    expect.any(SyntaxError),
  );
});

it("identifies the session once and truncates its id", () => {
  const state = createCliSessionState();
  const id = "s".repeat(250);
  expect(read({ sessionID: id }, state)).toEqual({
    identified: "s".repeat(200),
  });
  expect(state.events).toEqual([`session ${"s".repeat(192)}`]);
  expect(read({ sessionID: "other" }, state)).toEqual({});
  expect(state.sessionId).toBe("s".repeat(200));
});

it.each([[5], [""], [undefined]])("does not identify %j", (id) => {
  const state = createCliSessionState();
  expect(read({ sessionID: id }, state)).toEqual({});
  expect(state.sessionId).toBeNull();
});

it("accumulates text, resets it at a step start and ignores non-text", () => {
  const state = createCliSessionState();
  read({ type: "text", part: { text: "ab" } }, state);
  read({ type: "text", part: { text: "cd" } }, state);
  read({ type: "text", part: { text: 3 } }, state);
  expect(state.text).toBe("abcd");
  read({ type: "step_start" }, state);
  expect(state.text).toBe("");
});

it("notes tool use with its status", () => {
  const state = createCliSessionState();
  read(
    { type: "tool_use", part: { tool: "bash", state: { status: "ok" } } },
    state,
  );
  read({ type: "tool_use" }, state);
  expect(state.events).toEqual(["tool bash ok", "tool "]);
});

it("completes the turn only for a stop finish", () => {
  const state = createCliSessionState();
  read({ type: "step_finish", part: { reason: "tool-calls" } }, state);
  expect(state.isTurnComplete).toBe(false);
  read({ type: "step_finish", part: { reason: "stop" } }, state);
  expect(state.isTurnComplete).toBe(true);
  expect(state.events).toEqual(["turn completed"]);
});

it("marks an error event as failed", () => {
  const state = createCliSessionState();
  read({ type: "error", error: { name: "Boom" } }, state);
  expect(state.hasFailed).toBe(true);
  expect(state.events).toEqual(["error Boom"]);
});
