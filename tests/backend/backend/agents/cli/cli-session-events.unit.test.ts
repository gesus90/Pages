import { afterEach, expect, it, vi } from "vitest";

import {
  createCliSessionState,
  noteSessionEvent,
  readCliSessionLine,
} from "@/backend/agents/cli/CliSessionEvents";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  logging.logCaughtError.mockReset();
});

function line(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

it("keeps at most 60 compacted and shortened events", () => {
  const events: string[] = [];
  for (let index = 0; index < 61; index += 1)
    noteSessionEvent(events, `event\n  ${index}`);
  noteSessionEvent(events, "x".repeat(250));

  expect(events).toHaveLength(60);
  expect(events[0]).toBe("event 2");
  expect(events.at(-1)).toBe("x".repeat(200));
});

it("identifies the session once from the first named identifier", () => {
  const state = createCliSessionState();

  expect(
    readCliSessionLine("opencode", line({ sessionID: "" }), state),
  ).toEqual({});
  expect(
    readCliSessionLine("opencode", line({ sessionID: "s-1" }), state),
  ).toEqual({ identified: "s-1" });
  expect(
    readCliSessionLine("opencode", line({ sessionID: "s-2" }), state),
  ).toEqual({});

  expect(state.sessionId).toBe("s-1");
  expect(state.events).toEqual(["session s-1"]);
});

it("collects the text of the newest step", () => {
  const state = createCliSessionState();

  readCliSessionLine(
    "opencode",
    line({ type: "text", part: { text: "old" } }),
    state,
  );
  readCliSessionLine("opencode", line({ type: "step_start" }), state);
  readCliSessionLine(
    "opencode",
    line({ type: "text", part: { text: "new" } }),
    state,
  );
  readCliSessionLine(
    "opencode",
    line({ type: "text", part: { text: 5 } }),
    state,
  );

  expect(state.text).toBe("new");
});

it("notes tools, completed turns and errors", () => {
  const state = createCliSessionState();

  readCliSessionLine(
    "opencode",
    line({
      type: "tool_use",
      part: { tool: "bash", state: { status: "done" } },
    }),
    state,
  );
  readCliSessionLine(
    "opencode",
    line({ type: "step_finish", part: { reason: "tool-calls" } }),
    state,
  );
  expect(state.isTurnComplete).toBe(false);
  readCliSessionLine(
    "opencode",
    line({ type: "step_finish", part: { reason: "stop" } }),
    state,
  );
  readCliSessionLine(
    "opencode",
    line({ type: "error", error: { name: "ProviderAuthError" } }),
    state,
  );

  expect(state.isTurnComplete).toBe(true);
  expect(state.hasFailed).toBe(true);
  expect(state.events).toEqual([
    "tool bash done",
    "turn completed",
    "error ProviderAuthError",
  ]);
});

it("ignores diagnostic lines that are no JSON", () => {
  const state = createCliSessionState();

  expect(readCliSessionLine("opencode", "starting...", state)).toEqual({});

  expect(state.events).toEqual([]);
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliSessionEvents",
    expect.any(SyntaxError),
  );
});
