import { describe, expect, it, vi } from "vitest";

import { ClaudeCodeCli } from "@/backend/agents/cli/ClaudeCodeCli";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  CliHome,
  CliProcessResult,
} from "@/backend/agents/cli/CliContracts";
import type { CliToolExecution } from "@/backend/agents/cli/CliToolExecution";

const home = partial<CliHome>({
  root: "/virtual",
  home: "/virtual/home",
  config: "/virtual/config",
  work: "/virtual/work",
});
const signal = new AbortController().signal;
const success: CliProcessResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  errorCode: null,
};

function fixture(): {
  cli: ClaudeCodeCli;
  run: ReturnType<typeof vi.fn>;
  catalog: ReturnType<typeof vi.fn>;
} {
  const run = vi.fn();
  const catalog = vi.fn();
  return {
    cli: new ClaudeCodeCli(
      partial<CliToolExecution>({ run, readCatalog: catalog }),
    ),
    run,
    catalog,
  };
}

describe("Claude CLI behavior", () => {
  it("accepts only subscription login and sanitizes the account label", async () => {
    const { cli, run } = fixture();
    run
      .mockResolvedValueOnce({
        ...success,
        stdout:
          '{"loggedIn":true,"authMethod":"claude.ai","email":"a@example.test"}',
      })
      .mockResolvedValueOnce({
        ...success,
        stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"bad"}',
      })
      .mockResolvedValueOnce({
        ...success,
        stdout: '{"loggedIn":true,"authMethod":"api"}',
      })
      .mockResolvedValueOnce({ ...success, stdout: "bad" })
      .mockResolvedValueOnce({ ...success, errorCode: "check_timeout" });
    await expect(cli.readStatus(home, signal)).resolves.toMatchObject({
      outcome: { ok: true },
      accountLabel: "a@example.test",
    });
    await expect(cli.readStatus(home, signal)).resolves.toMatchObject({
      outcome: { ok: true },
      accountLabel: null,
    });
    await expect(cli.readStatus(home, signal)).resolves.toMatchObject({
      outcome: { errorCode: "cli_not_logged_in" },
    });
    await expect(cli.readStatus(home, signal)).resolves.toMatchObject({
      outcome: { errorCode: "cli_unexpected_output" },
    });
    await expect(cli.readStatus(home, signal)).resolves.toMatchObject({
      outcome: { errorCode: "check_timeout" },
    });
  });

  it("classifies login errors and test failures without running a process", async () => {
    const { cli, run } = fixture();
    expect(cli.loginError({ ...success, errorCode: "check_timeout" })).toBe(
      "login_expired",
    );
    expect(
      cli.loginError({ ...success, stderr: "Login failed: invalid code" }),
    ).toBe("login_code_rejected");
    expect(cli.loginError(success)).toBe("login_failed");
    run
      .mockResolvedValueOnce({ ...success, errorCode: "check_timeout" })
      .mockResolvedValueOnce({
        ...success,
        stdout:
          '{"is_error":false,"subtype":"success","usage":{},"modelUsage":{}}',
      });
    await expect(
      cli.runTest(home, { model: null, reasoningEffort: null }, signal),
    ).resolves.toMatchObject({ ok: false, errorCode: "check_timeout" });
    await expect(
      cli.runTest(home, { model: "model", reasoningEffort: "high" }, signal),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects failed model catalog reads and maps logout outcomes", async () => {
    const { cli, run, catalog } = fixture();
    catalog
      .mockResolvedValueOnce({ ...success, errorCode: "check_timeout" })
      .mockResolvedValueOnce({ ...success, exitCode: 1 });
    await expect(cli.listModels(home, signal)).rejects.toThrow();
    await expect(cli.listModels(home, signal)).rejects.toThrow();
    run
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce({ ...success, exitCode: 1 })
      .mockResolvedValueOnce({ ...success, errorCode: "check_timeout" });
    await expect(cli.logout(home, signal)).resolves.toMatchObject({ ok: true });
    await expect(cli.logout(home, signal)).resolves.toMatchObject({
      errorCode: "cli_check_failed",
    });
    await expect(cli.logout(home, signal)).resolves.toMatchObject({
      errorCode: "check_timeout",
    });
  });
});
