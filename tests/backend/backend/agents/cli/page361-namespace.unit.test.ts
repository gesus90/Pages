import { afterEach, expect, it, vi } from "vitest";

import { setNamespacePaused } from "@/backend/agents/cli/CliNamespacePause";

const boundary = vi.hoisted(() => ({
  ended: vi.fn(async () => false),
  command: vi.fn(
    (
      _file: string,
      _arguments: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    },
  ),
}));
vi.mock("node:child_process", () => ({ execFile: boundary.command }));
vi.mock("@/backend/agents/cli/CliOwnedNamespace", () => ({
  hasEndedOwnedNamespace: boundary.ended,
}));

const OWNER = {
  pid: 123,
  uid: 1000,
  start: 9,
  boot: "11111111-1111-4111-8111-111111111111",
};
const UNIT = "pages-acp-11111111-1111-4111-8111-111111111111-12345678.service";

afterEach(() => {
  vi.clearAllMocks();
  boundary.ended.mockResolvedValue(false);
});

it("freezes and thaws only the owned cgroup while leaving the owner protocol available", async () => {
  await setNamespacePaused({ ...OWNER, unit: UNIT }, true);
  await setNamespacePaused({ ...OWNER, unit: UNIT }, false);
  expect(boundary.command.mock.calls.map((call) => call.slice(0, 2))).toEqual([
    ["/usr/bin/systemctl", ["--user", "freeze", UNIT]],
    ["/usr/bin/systemctl", ["--user", "thaw", UNIT]],
  ]);
});

it("never signals an ended or reused process and refuses an unrelated unit", async () => {
  boundary.ended.mockResolvedValueOnce(true);
  await setNamespacePaused(OWNER, true);
  expect(boundary.command).not.toHaveBeenCalled();
  await expect(
    setNamespacePaused({ ...OWNER, unit: "another.service" }, true),
  ).rejects.toThrow("Invalid worker unit");
  expect(boundary.command).not.toHaveBeenCalled();
});

it("pins the supervisor and descendants through pidfds when a script has no cgroup", async () => {
  await setNamespacePaused(OWNER, true);
  expect(boundary.command).toHaveBeenCalledWith(
    "python3",
    [
      "-c",
      expect.stringContaining("pidfd_send_signal"),
      "123",
      "9",
      "1000",
      OWNER.boot,
      "pause",
    ],
    { timeout: 2000 },
    expect.any(Function),
  );
});
