import { expect, it } from "vitest";

import {
  parseProbeOutput,
  probeCommand,
} from "@/backend/service/remote/setup/RemoteInstallProbe";

it("parses known host facts and tool versions from a complete probe", () => {
  const output = [
    "banner",
    "os=ubuntu",
    "arch=x86_64",
    "runner=1",
    "runner_version=1.2.3",
    "service_manager=systemd",
    "service_query=1",
    "service_registered=1",
    "service_enabled=1",
    "service_active=1",
    "tool=codex:0.1",
    "tool=unknown:4",
    "probe=complete",
  ].join("\n");
  expect(parseProbeOutput(output)).toMatchObject({
    isUbuntu: true,
    architecture: "x86_64",
    isRunnerInstalled: true,
    isServiceActive: true,
    tools: [{ tool: "codex", version: "0.1" }],
  });
  expect(probeCommand()).toContain("/bin/sh -c");
});

it("refuses incomplete output and leaves missing facts unknown", () => {
  expect(() => parseProbeOutput("runner=1")).toThrow("Incomplete probe");
  expect(parseProbeOutput("probe=complete")).toMatchObject({
    isUbuntu: null,
    architecture: null,
    runnerVersion: null,
    isRunnerInstalled: false,
    tools: [],
  });
});
