import { expect, it } from "vitest";

import {
  renderTerminal,
  runningTerminalTool,
} from "@/app/components/agents/plans/plan-agent-console/terminal-lines";

import type {
  TerminalAttempt,
  TerminalEnding,
  TerminalInput,
  TerminalTexts,
} from "@/app/components/agents/plans/plan-agent-console/terminal-lines";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

const RESET = "\u001b[0m";
const TOOL = "\u001b[36m";
const SUCCESS = "\u001b[32m";
const ERROR = "\u001b[31m";
const TODO = "\u001b[33m";
const RESUME = "\u001b[35m";
const STRONG = "\u001b[1;97m";
const THOUGHT = "\u001b[2;3m";

const TEXTS: TerminalTexts = {
  attempt: (number) => `Attempt ${number}`,
  toolKind: (kind) => (kind === "execute" ? "Shell" : null),
  done: "done",
  aborted: "aborted",
  todoActive: (id, text) => `${id} active: ${text}`,
  todoDone: (id) => `${id} done`,
  turnEnded: "turn ended",
  interrupted: "interrupted",
  reportReceived: (done, total) => `report ${done}/${total}`,
  sessionClosed: "closed",
  abort: (reason) => `abort ${reason}`,
  noReport: "no report",
  resume: (seconds, restart, limit, isSameSession) =>
    `resume ${seconds}s ${restart}/${limit} ${isSameSession ? "same" : "new"}`,
  repair: (restart, limit, isSameSession) =>
    `repair ${restart}/${limit} ${isSameSession ? "same" : "new"}`,
  blocked: (reason, attempts) => `blocked ${reason} after ${attempts}`,
  stopped: "stopped",
};

let sequence = 0;

function event(
  kind: AgentSessionEvent["kind"],
  text: string,
  createdAt = "2026-10-26T10:00:00.000Z",
): AgentSessionEvent {
  sequence += 1;
  return {
    id: `attempt:${sequence}`,
    sequence,
    stepId: "node",
    attemptId: "attempt",
    turn: 1,
    kind,
    createdAt,
    text,
    isTruncated: false,
  };
}

function attempt(
  events: readonly AgentSessionEvent[],
  overrides: Partial<TerminalAttempt> = {},
): TerminalAttempt {
  return {
    number: 1,
    startedAt: "not a time",
    events,
    ending: null,
    ...overrides,
  };
}

function input(
  attempts: readonly TerminalAttempt[],
  overrides: Partial<TerminalInput> = {},
): TerminalInput {
  return {
    provider: "Provider",
    model: "model-1",
    prompt: null,
    attempts,
    todoTexts: new Map([["T1", "Read the code"]]),
    columns: null,
    texts: TEXTS,
    ...overrides,
  };
}

function rows(
  events: readonly AgentSessionEvent[],
  overrides: Partial<TerminalAttempt> = {},
  inputOverrides: Partial<TerminalInput> = {},
): readonly string[] {
  // The first row is the header of the attempt.
  return renderTerminal(
    input([attempt(events, overrides)], inputOverrides),
  ).rows.slice(1);
}

it("draws the header with provider, model, attempt, an unreadable time as dashes and the prompt of the first attempt only", () => {
  const first = renderTerminal(
    input([attempt([]), attempt([], { number: 2, startedAt: null })], {
      prompt: "First line\nSecond \u001b[31mline\u001b[0m",
    }),
  );
  expect(first.rows[0]).toBe(
    "\u001b[90m── Provider · model-1 · Attempt 1 · --:-- ──────────────\u001b[0m",
  );
  expect(first.rows.slice(1, 3)).toEqual([
    `${STRONG}> First line${RESET}`,
    `${STRONG}  Second line${RESET}`,
  ]);
  // An empty line separates attempts and the second one has no prompt.
  expect(first.rows[3]).toBe("");
  expect(first.rows[4]).toContain("Attempt 2 · --:--");
  expect(first.rows).toHaveLength(5);
});

it("shows a readable start time in HH:MM form", () => {
  const [header] = renderTerminal(
    input([attempt([], { startedAt: "2026-10-26T10:15:00.000Z" })]),
  ).rows;
  const clock = new Date("2026-10-26T10:15:00.000Z").toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  );
  expect(header).toContain(`Attempt 1 · ${clock} ─`);
});

it("draws instructions bold, strips control sequences and keeps answers and thoughts as joined blocks", () => {
  expect(
    rows([
      event("user_instruction", "Do it\n\u001b[1mnow\u001b[0m\u0007"),
      event("repair_instruction", "Fix it"),
      event("agent_message", "Hello "),
      event("agent_message", "world\n\n"),
      event("thought", "Thinking"),
      event("agent_message", "\n\nAfter"),
    ]),
  ).toEqual([
    `${STRONG}> Do it${RESET}`,
    `${STRONG}  now${RESET}`,
    `${STRONG}> Fix it${RESET}`,
    "",
    "Hello world",
    "",
    `${THOUGHT}Thinking${RESET}`,
    "",
    "After",
  ]);
});

it("styles every line of a multi-line thought", () => {
  expect(rows([event("thought", "one\ntwo")])).toEqual([
    "",
    `${THOUGHT}one${RESET}`,
    `${THOUGHT}two${RESET}`,
  ]);
});

it("names a tool by its kind label and command, and by its title when the kind has no label", () => {
  expect(
    rows([
      event("tool_started", "Run tests\n@kind execute\n$ pnpm test"),
      event(
        "tool_completed",
        "Run tests\n@kind execute\n$ pnpm test\n\nall passed\nmore",
      ),
      event("tool_started", "Fetch page\n@kind other\n$ https://x.test"),
      event(
        "tool_completed",
        'Fetch page\n@kind other\n$ https://x.test\n{"json":true}',
      ),
      event("tool_completed", "Orphan"),
    ]),
  ).toEqual([
    `${TOOL}● Shell  pnpm test${RESET}`,
    `${SUCCESS}  ✓ all passed${RESET}`,
    `${TOOL}● Fetch page  https://x.test${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
    `${TOOL}● Orphan${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
  ]);
});

it("falls back to the title for a labelled kind without a command and to a generic name without a title", () => {
  expect(
    rows([
      event("tool_completed", "Listing\n@kind execute"),
      event("tool_completed", "\n$ ls"),
      event("tool_completed", "Same\n@kind other\n$ Same"),
      event("tool_completed", 'Args\n@kind execute\n$ {"a":1}'),
    ]),
  ).toEqual([
    `${TOOL}● Shell  Listing${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
    `${TOOL}● Tool  ls${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
    `${TOOL}● Same${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
    `${TOOL}● Shell  Args${RESET}`,
    `${SUCCESS}  ✓ done${RESET}`,
  ]);
});

it("matches a result to the running call with the same title, else the oldest one, and keeps the input when the result has none", () => {
  expect(
    rows([
      event("tool_started", "First\n@kind execute\n$ one"),
      event("tool_started", "Second\n@kind execute\n$ two"),
      event("tool_completed", "Second\n$ two final\nresult two"),
      event("tool_failed", "Renamed\nboom"),
      event("tool_started", "Third"),
      event("tool_completed", "Third\nfine"),
    ]),
  ).toEqual([
    `${TOOL}● Shell  one${RESET}`,
    `${ERROR}  ✗ boom${RESET}`,
    `${TOOL}● Shell  two final${RESET}`,
    `${SUCCESS}  ✓ result two${RESET}`,
    `${TOOL}● Third${RESET}`,
    `${SUCCESS}  ✓ fine${RESET}`,
  ]);
  expect(
    rows([
      event("tool_started", "Keep\n@kind execute\n$ cmd"),
      event("tool_completed", "Keep\nok"),
    ]),
  ).toEqual([`${TOOL}● Shell  cmd${RESET}`, `${SUCCESS}  ✓ ok${RESET}`]);
});

it("shortens long results to one line, fails an empty failure as aborted and shows a running call head only", () => {
  const long = "x".repeat(200);
  const [, result] = rows([
    event("tool_completed", `Read\n@kind other\n${long}`),
  ]);
  expect(result).toBe(`${SUCCESS}  ✓ ${"x".repeat(160)} …${RESET}`);
  expect(rows([event("tool_failed", "Broken")])).toEqual([
    `${TOOL}● Broken${RESET}`,
    `${ERROR}  ✗ aborted${RESET}`,
  ]);
  expect(rows([event("tool_started", "Busy")])).toEqual([
    `${TOOL}● Busy${RESET}`,
  ]);
});

it("fails a running call once the attempt ended or its turn was cut short", () => {
  expect(
    rows([event("tool_started", "Busy")], {
      ending: { kind: "stopped" },
    }),
  ).toEqual([
    `${TOOL}● Busy${RESET}`,
    `${ERROR}  ✗ aborted${RESET}`,
    `${ERROR}◆ stopped${RESET}`,
  ]);
  for (const text of [
    "turn 2 ended",
    "turn 2 continued",
    "turn cancelled by user",
  ]) {
    const drawn = rows([event("tool_started", "Busy"), event("status", text)]);
    expect(drawn[1]).toBe(`${ERROR}  ✗ aborted${RESET}`);
  }
});

it("announces the end of a turn and an interruption by the executor, but no other status", () => {
  expect(
    rows([
      event("status", "turn 1 ended"),
      event("status", "turn cancelled by the executor"),
      event("status", "turn cancelled by user"),
      event("status", "whatever"),
      event("status", "turn 1 continued"),
    ]),
  ).toEqual([
    `${SUCCESS}◆ turn ended${RESET}`,
    `${RESUME}◆ interrupted${RESET}`,
  ]);
});

it("reports only changed todo states, finished ones first, with the text of the contract", () => {
  const drawn = rows([
    event(
      "progress",
      JSON.stringify({ todos: [{ id: "T1", status: "active" }] }),
    ),
    event(
      "progress",
      JSON.stringify({ todos: [{ id: "T1", status: "active" }] }),
    ),
    event(
      "progress",
      JSON.stringify({
        todos: [
          { id: "T2", status: "active" },
          { id: "T1", status: "done" },
          { id: "T3", status: "done" },
          { id: "T4", status: "open" },
          { id: 5, status: "done" },
          "junk",
        ],
      }),
    ),
  ]);
  expect(drawn).toEqual([
    `${TODO}◆ T1 active: Read the code${RESET}`,
    `${TODO}◆ T1 done · T3 done${RESET}`,
    `${TODO}◆ T2 active: ${RESET}`,
  ]);
});

it("draws no line for unreadable progress, and todo state is shared across attempts", () => {
  expect(
    rows([
      event("progress", "not json"),
      event("progress", "null"),
      event("progress", "[]"),
      event("progress", JSON.stringify({ todos: "none" })),
      event("progress", JSON.stringify({ other: 1 })),
    ]),
  ).toEqual([]);
  const progress = event(
    "progress",
    JSON.stringify({ todos: [{ id: "T1", status: "active" }] }),
  );
  const { rows: all } = renderTerminal(
    input([attempt([progress]), attempt([progress], { number: 2 })]),
  );
  expect(all.filter((row) => row.includes("T1 active"))).toHaveLength(1);
});

it("draws errors and recoveries as one line, skips turn errors, plans and usage", () => {
  expect(
    rows([
      event("error", "turn failed: details"),
      event("error", "\n  Provider said no\nsecond"),
      event("recovery", "Recovering the session"),
      event("plan", "a plan"),
      event("usage", "{}"),
    ]),
  ).toEqual([
    `${ERROR}✗ Provider said no${RESET}`,
    `${RESUME}◆ Recovering the session${RESET}`,
  ]);
});

it("draws the closing stations of every ending", () => {
  const endings = (ending: TerminalEnding): readonly string[] =>
    rows([], { ending });
  expect(endings({ kind: "succeeded", done: 2, total: 3 })).toEqual([
    `${SUCCESS}◆ report 2/3${RESET}`,
    `${SUCCESS}◆ closed${RESET}`,
  ]);
  expect(endings({ kind: "blocked", reason: "no_way", attempts: 4 })).toEqual([
    `${ERROR}◆ blocked no_way after 4${RESET}`,
  ]);
  expect(endings({ kind: "stopped" })).toEqual([`${ERROR}◆ stopped${RESET}`]);
  expect(endings({ kind: "aborted", reason: "boom", resume: null })).toEqual([
    `${ERROR}◆ abort boom${RESET}`,
  ]);
  expect(
    endings({
      kind: "aborted",
      reason: "boom",
      resume: {
        delaySeconds: 10,
        restart: 1,
        limit: 3,
        isSameSession: true,
        isRepair: false,
      },
    }),
  ).toEqual([
    `${ERROR}◆ abort boom${RESET}`,
    `${RESUME}◆ resume 10s 1/3 same${RESET}`,
  ]);
  expect(
    endings({
      kind: "aborted",
      reason: "boom",
      resume: {
        delaySeconds: 0,
        restart: 2,
        limit: 2,
        isSameSession: false,
        isRepair: true,
      },
    }),
  ).toEqual([
    `${ERROR}◆ no report${RESET}`,
    `${RESUME}◆ repair 2/2 new${RESET}`,
  ]);
});

it("wraps lines at word boundaries once the terminal is measured and tells where each line starts", () => {
  const result = renderTerminal(
    input(
      [attempt([event("agent_message", "alpha beta gamma delta epsilon")])],
      { columns: 12 },
    ),
  );
  expect(result.rows).toContain("alpha beta");
  expect(result.rows).toContain("gamma delta");
  expect(result.rows).toContain("epsilon");
  // Header, empty line and answer are three lines; the header wraps too.
  expect(result.lineStarts).toHaveLength(3);
  expect(result.lineStarts[0]).toBe(0);
  expect(result.rows[result.lineStarts[1] ?? -1]).toBe("");
  expect(result.rows.slice(result.lineStarts[2])).toEqual([
    "alpha beta",
    "gamma delta",
    "epsilon",
  ]);
});

it("reports the newest running call of the open attempt for the status line", () => {
  const started = "2026-10-26T10:00:05.000Z";
  const running = runningTerminalTool(
    input([
      attempt([
        event("tool_started", "Old\n@kind execute\n$ old"),
        event("tool_completed", "Old\nok"),
        event("tool_started", "Run\n@kind execute\n$ pnpm test", started),
      ]),
    ]),
  );
  expect(running).toEqual({
    name: "Shell",
    detail: "pnpm test",
    startedAt: Date.parse(started),
  });
});

it("reports no running call without attempts, for an ended attempt or when all calls finished", () => {
  const open = [event("tool_started", "Run")];
  expect(runningTerminalTool(input([]))).toBeNull();
  expect(
    runningTerminalTool(
      input([attempt(open, { ending: { kind: "stopped" } })]),
    ),
  ).toBeNull();
  expect(
    runningTerminalTool(
      input([attempt([...open, event("tool_completed", "Run")])]),
    ),
  ).toBeNull();
});

it("reports a running call with an unreadable start time as null", () => {
  expect(
    runningTerminalTool(
      input([attempt([event("tool_started", "Run", "never")])]),
    ),
  ).toEqual({ name: "Run", detail: "", startedAt: null });
});
