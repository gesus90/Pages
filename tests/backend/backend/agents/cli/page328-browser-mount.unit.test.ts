import { expect, it, vi } from "vitest";

import { acpDriverFor } from "@/backend/agents/acp/AcpDrivers";
import { acpWorkerRequest } from "@/backend/agents/cli/CliAcpLaunch";
import { CliPlanIsolation } from "@/backend/agents/cli/CliPlanIsolation";
import { acpRunOptions } from "@/definition/AgentConfiguration";

import { sessionInput } from "./cli-session-input";

vi.mock("node:fs/promises", () => ({ realpath: async (file: string) => file }));
vi.mock("@/backend/agents/cli/CliSshConfigOverlay", () => ({
  sshConfigOverlayArguments: async () => [],
}));

it("mounts only the job's private runtime directory read-only into Arbeitsplatz, outside its writable folder", async () => {
  const directory = "/tmp/pages-agent-browser-unit/conversation";
  const input = sessionInput("codex_cli", acpRunOptions("yolo", 0), {
    chat: {
      browserStateDirectory: directory,
      resumeSessionId: null,
      listener: { prompted: () => undefined, update: () => undefined },
    },
  });
  const request = acpWorkerRequest({
    input,
    driver: acpDriverFor("codex_cli"),
    mode: "yolo",
    launch: { environment: {}, mcpServers: [], sessionMeta: {} },
    adapter: "/adapter",
    provider: "codex_cli",
    home: {
      root: "/home/agent",
      home: "/home/agent/home",
      config: "/home/agent/config",
      work: "/home/agent/work",
    },
    github: null,
    picaNative: null,
    picaBundle: null,
    signal: new AbortController().signal,
    onLine: () => undefined,
  });
  expect(request.readOnlyFiles).toEqual([directory]);
  expect(request.isWorkingDirectoryReadOnly).toBe(false);
  const isolated = await new CliPlanIsolation(
    ["/instance"],
    async () => true,
  ).isolate(request);
  const args = isolated?.arguments ?? [];
  const mountIndex = args.indexOf(directory);
  expect(args.slice(mountIndex - 1, mountIndex + 2)).toEqual([
    "--ro-bind",
    directory,
    directory,
  ]);
  expect(args.indexOf("/tmp")).toBeLessThan(mountIndex);
  expect(args).not.toContain(
    "/tmp/pages-agent-browser-unit/other-conversation",
  );
});
