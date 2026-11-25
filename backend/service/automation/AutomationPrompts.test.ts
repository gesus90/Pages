import { afterEach, expect, it, vi } from "vitest";

import {
  actionPrompt,
  firstBytes,
  forwardPrompt,
  lastBytes,
  noticePrompt,
} from "./AutomationPrompts";

import type { StoredAutomation } from "@/backend/database/repositories/automation/AutomationRepository";
import type { StoredAutomationRun } from "@/backend/database/repositories/automation/AutomationRunRepository";
import type { AutomationNoticeData } from "./AutomationPrompts";

function automation(action: StoredAutomation["action"]): StoredAutomation {
  return {
    id: "a1",
    creatorId: "u1",
    name: "Nightly",
    trigger: { type: "manual" },
    action,
    sharing: { scope: "private" },
    isActive: true,
    deleteAfterSuccess: false,
    agentNotification: { mode: "off" },
    nextRunAt: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function run(triggerData: string | null): StoredAutomationRun {
  return {
    id: "r1",
    sequence: 1,
    automationId: "a1",
    triggerKind: "manual",
    eventType: null,
    triggerSubject: null,
    triggerData,
    requestedBy: null,
    status: "queued",
    outcome: null,
    exitCode: null,
    forwardState: null,
    planRunId: null,
    planRunStatus: null,
    paused: false,
    errorCode: null,
    summary: null,
    answer: null,
    output: null,
    error: null,
    queuedAt: "2026-01-01T00:00:00Z",
    startedAt: null,
    endedAt: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes Buffer.from answer a buffer whose bytes read as undefined. */
function hideBytes(): void {
  const original = Buffer.from.bind(Buffer);
  vi.spyOn(Buffer, "from").mockImplementation((...args: unknown[]) => {
    const real = original(String(args[0]), "utf8");
    return new Proxy(real, {
      get(target, property) {
        if (typeof property === "string" && /^\d+$/.test(property))
          return undefined;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

const AGENT = automation({ type: "agent", agentId: "g", instruction: "Do it" });

it("keeps a short text whole", () => {
  expect(firstBytes("abc", 3)).toBe("abc");
  expect(lastBytes("abc", 3)).toBe("abc");
});

it("cuts the first bytes at a character boundary", () => {
  expect(firstBytes("abcd", 2)).toBe("ab");
  expect(firstBytes("aä", 2)).toBe("a");
  expect(firstBytes("ää", 1)).toBe("");
});

it("cuts the last bytes at a character boundary", () => {
  expect(lastBytes("abcd", 2)).toBe("cd");
  expect(lastBytes("äb", 2)).toBe("b");
  expect(lastBytes("ää", 3)).toBe("ä");
});

it("treats unreadable bytes as character boundaries", () => {
  hideBytes();
  expect(firstBytes("abcd", 2)).toBe("ab");
  expect(lastBytes("abcd", 2)).toBe("cd");
});

it("builds the action prompt with trigger data", () => {
  const text = actionPrompt(AGENT, run('{"a":1}'), "en");
  expect(text).toContain('[Automation "Nightly" · run r1]');
  expect(text).toContain("Do it");
  expect(text).toContain('Data of the trigger (JSON):\n```json\n{"a":1}\n```');
});

it("builds the action prompt without data in German", () => {
  const text = actionPrompt(AGENT, run(null), "de");
  expect(text).toContain("[Automation „Nightly“ · Lauf r1]");
  expect(text).not.toContain("```");
});

it("uses an empty instruction for other actions", () => {
  const plan = automation({ type: "plan", planId: "p" });
  expect(actionPrompt(plan, run(null), "en").split("\n")[2]).toBe("");
});

it("builds the forward prompt with output and exit code", () => {
  const text = forwardPrompt(
    AGENT,
    run("{}"),
    { exitCode: 2, output: "boom" },
    "en",
  );
  expect(text).toContain("Exit code: 2");
  expect(text).toContain("```\nboom\n```");
  expect(text).toContain("```json");
});

it("marks missing output and exit code", () => {
  const text = forwardPrompt(
    AGENT,
    run(null),
    { exitCode: null, output: "" },
    "de",
  );
  expect(text).toContain("Exit-Code: –");
  expect(text).toContain("(keine Ausgabe)");
});

function notice(
  result: string | null,
  error: string | null,
): AutomationNoticeData {
  return {
    automationId: "a1",
    name: "Nightly",
    runId: "r1",
    event: "run",
    status: "ok",
    at: "2026-01-01T00:00:00Z",
    exitCode: 0,
    result,
    error,
  };
}

it("builds the notice prompt with null result and error", () => {
  const text = noticePrompt(notice(null, null), "en");
  expect(text).toContain('"result": null');
  expect(text).toContain('"error": null');
});

it("bounds result and error of a notice", () => {
  const text = noticePrompt(notice("r".repeat(5000), "e".repeat(5000)), "de");
  expect(text).toContain("Ergebnis eines Laufs");
  expect(text).toContain(`"result": "${"r".repeat(4096)}"`);
  expect(text).toContain(`"error": "${"e".repeat(4096)}"`);
});
