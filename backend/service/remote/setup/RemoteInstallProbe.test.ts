import { describe, expect, it } from "vitest";

import { parseProbeOutput, probeCommand } from "./RemoteInstallProbe";

const FULL_OUTPUT = [
  "banner without separator",
  "=ignored",
  "os=ubuntu",
  "arch=x86_64",
  "runner=1",
  "runner_version=1.2.3",
  "service_manager=systemd",
  "service_query=1",
  "service_registered=1",
  "service_enabled=1",
  "service_active=1",
  "tool=codex:0.1.0",
  "tool=claude:",
  "probe=complete",
].join("\n");

describe("probeCommand", () => {
  it("runs the script under a POSIX shell and lists the packaged tools", () => {
    const command = probeCommand();

    expect(command.startsWith("/bin/sh -c ")).toBe(true);
    expect(command).toContain("@openai/codex");
    expect(command).toContain("opencode-ai");
    expect(command).not.toContain("antigravity:");
    expect(command).toContain("probe=complete");
  });
});

describe("parseProbeOutput", () => {
  it("reads every fact of a complete probe", () => {
    expect(parseProbeOutput(FULL_OUTPUT)).toEqual({
      isUbuntu: true,
      architecture: "x86_64",
      serviceManager: "systemd",
      canQueryService: true,
      isRunnerInstalled: true,
      runnerVersion: "1.2.3",
      isServiceInstalled: true,
      isServiceEnabled: true,
      isServiceActive: true,
      tools: [
        { tool: "codex", version: "0.1.0" },
        { tool: "claude", version: null },
      ],
    });
  });

  it("keeps unknown facts unknown", () => {
    expect(parseProbeOutput("probe=complete")).toEqual({
      isUbuntu: null,
      architecture: null,
      serviceManager: null,
      canQueryService: false,
      isRunnerInstalled: false,
      runnerVersion: null,
      isServiceInstalled: false,
      isServiceEnabled: false,
      isServiceActive: false,
      tools: [],
    });
  });

  it("recognises another system and an empty runner version", () => {
    const observation = parseProbeOutput(
      "os=debian\nrunner_version=\nprobe=complete",
    );

    expect(observation.isUbuntu).toBe(false);
    expect(observation.runnerVersion).toBeNull();
  });

  it("rejects an incomplete probe", () => {
    expect(() => parseProbeOutput("os=ubuntu")).toThrow("Incomplete probe");
  });

  it("rejects values that break the observation schema", () => {
    expect(() => parseProbeOutput("arch=bad value!\nprobe=complete")).toThrow();
  });
});
