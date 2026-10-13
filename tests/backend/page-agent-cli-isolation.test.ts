import { access, realpath } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ access: vi.fn(), realpath: vi.fn() }));

import { isolateCliPlan } from "@/backend/agents/cli/CliPlanIsolation";

import type { CliRunRequest } from "@/backend/agents/cli/CliContracts";

function request(): CliRunRequest {
  return {
    file: "/usr/bin/agent-cli",
    arguments: ["exec", "-"],
    provider: "codex_cli",
    home: {
      root: "/instance/agents/connection",
      home: "/instance/agents/connection/home",
      config: "/instance/agents/connection/config",
      work: "/instance/agents/connection/work",
    },
    workingDirectory: "/approved/copy",
    timeoutMs: 600000,
    stdin: "pipe",
    input: "Try to change or delete /instance/.pages/Agents/agent/AGENT.md",
  };
}

describe("PAGE-20 CLI filesystem isolation", () => {
  it("hides all instance files and gives write access only to the authorized working copy and credential home", async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(realpath).mockImplementation(async (filename) =>
      String(filename),
    );
    const proposed = request();
    const isolated = await isolateCliPlan(proposed, "/instance");
    expect(isolated.file).toBe("/usr/bin/bwrap");
    expect(isolated.arguments).toEqual([
      "--die-with-parent",
      "--unshare-pid",
      "--new-session",
      "--ro-bind",
      "/",
      "/",
      "--proc",
      "/proc",
      "--dev",
      "/dev",
      "--tmpfs",
      "/tmp",
      "--bind",
      "/approved/copy",
      "/approved/copy",
      "--tmpfs",
      "/instance",
      "--bind",
      "/instance/agents/connection",
      "/instance/agents/connection",
      "--chdir",
      "/approved/copy",
      "--",
      "/usr/bin/agent-cli",
      "exec",
      "-",
    ]);
    expect(isolated.input).toBe(proposed.input);
    expect(isolated.arguments).not.toContain(proposed.input);
  });

  it("refuses to dispatch any model prompt when isolation is missing or cwd resolves into the protected instance", async () => {
    vi.mocked(access).mockRejectedValue(new Error("Unavailable"));
    await expect(isolateCliPlan(request(), "/instance")).rejects.toMatchObject({
      code: "cli_not_executable",
    });
    expect(realpath).not.toHaveBeenCalled();
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(realpath).mockImplementation(async (filename) =>
      String(filename),
    );
    for (const directory of ["/instance", "/instance/.pages/Agents/agent"])
      await expect(
        isolateCliPlan(
          { ...request(), workingDirectory: directory },
          "/instance",
        ),
      ).rejects.toMatchObject({ code: "plan_directory_required" });
  });
});
