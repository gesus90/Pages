import { afterEach, expect, it, vi } from "vitest";

import { CliPausableDeadline } from "@/backend/agents/cli/CliPausableDeadline";
import {
  forgetScriptRunPause,
  registerScriptPause,
  setScriptRunPaused,
} from "@/backend/service/agents/AgentPlanScriptPause";

const boundary = vi.hoisted(() => ({
  pause: vi.fn<(owner: unknown, isPaused: boolean) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock("@/backend/agents/cli/CliNamespacePause", () => ({
  setNamespacePaused: boundary.pause,
}));
const NAMESPACE = {
  pid: 42,
  uid: 1000,
  start: 1,
  boot: "11111111-1111-4111-8111-111111111111",
};

afterEach(() => {
  vi.useRealTimers();
  boundary.pause.mockReset().mockResolvedValue(undefined);
});

it("freezes a script registered during pause before its launch pipe is released and preserves its timeout", async () => {
  vi.useFakeTimers();
  await setScriptRunPaused("script-paused-before-spawn", true);
  const expire = vi.fn();
  const deadline = new CliPausableDeadline(1000, expire);
  const unregister = await registerScriptPause({
    runId: "script-paused-before-spawn",
    namespace: NAMESPACE,
    deadline,
  });
  expect(boundary.pause).toHaveBeenLastCalledWith(NAMESPACE, true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(expire).not.toHaveBeenCalled();
  await setScriptRunPaused("script-paused-before-spawn", false);
  expect(boundary.pause).toHaveBeenLastCalledWith(NAMESPACE, false);
  await vi.advanceTimersByTimeAsync(999);
  expect(expire).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledOnce();
  unregister();
  deadline.close();
  forgetScriptRunPause("script-paused-before-spawn");
});

it("serializes a late freeze with Resume so the script cannot remain frozen after Resume returned", async () => {
  vi.useFakeTimers();
  await setScriptRunPaused("script-resume-race", true);
  let acknowledge = (): void => undefined;
  boundary.pause.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const deadline = new CliPausableDeadline(1000, vi.fn());
  const registering = registerScriptPause({
    runId: "script-resume-race",
    namespace: NAMESPACE,
    deadline,
  });
  await vi.waitFor(() => expect(boundary.pause).toHaveBeenCalledOnce());
  const resume = setScriptRunPaused("script-resume-race", false);
  expect(boundary.pause).toHaveBeenCalledOnce();
  acknowledge();
  const unregister = await registering;
  await resume;
  expect(boundary.pause.mock.calls.map((call) => call[1])).toEqual([
    true,
    false,
  ]);
  unregister();
  deadline.close();
  forgetScriptRunPause("script-resume-race");
});
