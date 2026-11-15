import { afterEach, expect, it, vi } from "vitest";

import { controlOwnedNamespace } from "@/backend/agents/cli/CliNamespaceControl";
import { hasEndedOwnedNamespace } from "@/backend/agents/cli/CliOwnedNamespace";
import { planTurnTimeout } from "@/backend/service/agents/AgentPlanTimeout";
import {
  planPauseGate,
  forgetPlanPauseGate,
} from "@/backend/service/agents/AgentPlanPauseGate";

vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: vi.fn(async () => false),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (file: string) =>
    file.includes("/101/") ? "102" : "",
  ),
}));

const owner = {
  pid: 101,
  uid: 1000,
  start: 1,
  boot: "10000000-0000-4000-8000-000000000001",
};

afterEach(() => {
  vi.useRealTimers();
});

it("suspends and resumes the owned process and children without terminating them", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  await controlOwnedNamespace(owner, "pause");
  expect(kill.mock.calls).toEqual([
    [101, "SIGSTOP"],
    [102, "SIGSTOP"],
    [102, "SIGSTOP"],
    [101, "SIGSTOP"],
  ]);
  kill.mockClear();
  await controlOwnedNamespace(owner, "resume");
  expect(kill.mock.calls).toEqual([
    [102, "SIGCONT"],
    [101, "SIGCONT"],
  ]);
});

it("Stop kills all recorded descendants and the root even when paused", async () => {
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  await controlOwnedNamespace(owner, "stop");
  expect(kill.mock.calls).toEqual([
    [102, "SIGKILL"],
    [101, "SIGKILL"],
  ]);
});

it("never signals a reused or already ended process identity", async () => {
  vi.mocked(hasEndedOwnedNamespace).mockResolvedValueOnce(true);
  const kill = vi.spyOn(process, "kill").mockReturnValue(true);
  await controlOwnedNamespace(owner, "stop");
  expect(kill).not.toHaveBeenCalled();
});

it("excludes paused time from the turn deadline", async () => {
  vi.useFakeTimers();
  const timeout = planTurnTimeout(
    "page357-timeout",
    1000,
    new AbortController().signal,
  );
  await vi.advanceTimersByTimeAsync(500);
  planPauseGate("page357-timeout").pause();
  await vi.advanceTimersByTimeAsync(60000);
  expect(timeout.signal.aborted).toBe(false);
  planPauseGate("page357-timeout").resume();
  await vi.advanceTimersByTimeAsync(600);
  expect(timeout.signal.aborted).toBe(true);
  timeout.dispose();
  forgetPlanPauseGate("page357-timeout");
});
