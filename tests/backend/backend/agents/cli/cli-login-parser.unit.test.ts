import { afterEach, expect, it, vi } from "vitest";

import { readCodexChallenge } from "@/backend/agents/cli/CliLoginParser";

const logging = vi.hoisted(() => ({ logCaughtError: vi.fn() }));

vi.mock("@/backend/logging/Logger", () => logging);

afterEach(() => {
  logging.logCaughtError.mockReset();
});

it("skips a link that is no valid URL and keeps reading", () => {
  const output =
    "Open https://[broken then https://auth.openai.com/codex/device\nCode ABCD-EFGH\n";

  expect(readCodexChallenge(output)).toEqual({
    verificationUrl: "https://auth.openai.com/codex/device",
    userCode: "ABCD-EFGH",
  });
  expect(logging.logCaughtError).toHaveBeenCalledWith(
    "CliLoginParser",
    expect.any(TypeError),
  );
});
