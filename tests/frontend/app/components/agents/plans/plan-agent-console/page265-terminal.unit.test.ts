import { expect, it } from "vitest";

import { mergeToolEvents } from "@/app/components/agents/plans/plan-agent-console/console-history";
import { isTerminalSession } from "@/app/components/agents/plans/plan-agent-console/console-target";
import { formatDuration } from "@/app/components/agents/plans/plan-agent-console/console-time";
import { isTerminalAnswer } from "@/app/components/agents/plans/plan-agent-console/terminal-client";

import { historyEvent } from "../../page161-session-fixture";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";
import { cliSession, cliStep } from "./console-fixture";

import type { AgentPlanRun } from "@/definition/AgentPlan";

it("never passes automatic answers of the browser terminal on as typed input", () => {
  for (const answer of [
    "\u001b[?1;2c",
    "\u001b[>0;276;0c",
    "\u001b[12;40R",
    "\u001b]11;rgb:0000/0000/0000\u0007",
    "\u001bP>|xterm\u001b\\",
    "\u001b[?2004;1$y",
  ])
    expect(isTerminalAnswer(answer)).toBe(true);
  for (const keys of ["a", "\r", "\u001b", "\u001b[A", "/model\r", "\u0003"])
    expect(isTerminalAnswer(keys)).toBe(false);
});

it("shows one entry per finished tool call and keeps a running one", () => {
  const tool = (
    sequence: number,
    kind: AgentSessionEvent["kind"],
    text: string,
  ): AgentSessionEvent => ({ ...historyEvent(sequence), kind, text });
  const events = [
    tool(1, "tool_started", "Bash\n$ pnpm test"),
    tool(2, "tool_started", "Read\n$ README.md"),
    tool(3, "tool_completed", "Bash\n$ pnpm test\n12 passed"),
  ];
  expect(mergeToolEvents(events).map((event) => event.sequence)).toEqual([
    2, 3,
  ]);
});

it("finds the shared terminal of a group member through its process", () => {
  const starter = cliStep({
    id: "writer",
    session: cliSession({ instanceId: "process", surface: "terminal" }),
  });
  const member = cliStep({
    id: "reviewer",
    session: cliSession({ instanceId: "process" }),
  });
  const other = cliStep({
    id: "other",
    session: cliSession({ instanceId: "acp" }),
  });
  const run: Pick<AgentPlanRun, "steps"> = { steps: [starter, member, other] };
  expect(isTerminalSession(run, member)).toBe(true);
  expect(isTerminalSession(run, other)).toBe(false);
});

it("reads durations at a glance", () => {
  expect(formatDuration(42_000)).toBe("42 s");
  expect(formatDuration(125_000)).toBe("2 min 5 s");
  expect(formatDuration(3_840_000)).toBe("1 h 4 min");
});
