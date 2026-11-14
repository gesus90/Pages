import { describe, expect, it } from "vitest";

import { consoleViewOf } from "@/app/components/agents/workspaces/remote/console/console-view";
import {
  effectiveSetupProgress,
  shownPhaseIndex,
} from "@/app/components/agents/workspaces/remote/console/setup-view";
import { resolveScreenReaderMode } from "@/app/components/agents/workspaces/remote/console/screen-reader-mode";
import { INITIAL_SETUP_PROGRESS, SETUP_PHASES } from "@/definition/RemoteSetup";

import { state } from "./console-client-fixture";

describe("console view", () => {
  it("maps connection and termination states", () => {
    expect(consoleViewOf(state({ status: "connecting" }), false)).toBe(
      "connecting",
    );
    expect(consoleViewOf(state({ status: "connected" }), true)).toBe(
      "connected",
    );
    expect(consoleViewOf(state({ status: "reconnecting" }), false)).toBe(
      "connecting",
    );
    expect(consoleViewOf(state({ status: "reconnecting" }), true)).toBe(
      "reconnecting",
    );
    expect(consoleViewOf(state({ status: "ended" }), true)).toBe("exited");
    expect(
      consoleViewOf(
        state({
          status: "ended",
          message: "remote.error.remote_access_denied",
        }),
        true,
      ),
    ).toBe("accessRevoked");
    expect(
      consoleViewOf(state({ status: "ended", message: "other" }), true),
    ).toBe("failed");
  });

  it.each([
    [null, false, "failed"],
    ["remote.error.remote_access_denied", true, "accessRevoked"],
    ["remote.console.loadFailed", true, "ptyUnavailable"],
    ["remote.failure.host_key_changed", true, "hostKeyChanged"],
    ["remote.failure.password_rejected", true, "authFailed"],
    ["remote.failure.unreachable_timeout", false, "unreachable"],
    ["remote.failure.unreachable_timeout", true, "lost"],
    ["other", false, "failed"],
  ] as const)(
    "classifies a blocked console with message %s",
    (message, hasConnected, expected) => {
      expect(
        consoleViewOf(state({ status: "blocked", message }), hasConnected),
      ).toBe(expected);
    },
  );
});

describe("setup progress", () => {
  it("uses reported progress and synthesizes a first-phase failure only after a refusal", () => {
    const setup = { ...INITIAL_SETUP_PROGRESS, step: "upload" as const };
    expect(effectiveSetupProgress(state({ setup }), "connected")).toBe(setup);
    const failed = effectiveSetupProgress(
      state({ status: "blocked", message: "remote.error.denied" }),
      "failed",
    );
    expect(failed).toMatchObject({
      step: "rights",
      outcome: "failed",
      reason: "remote.error.denied",
    });
    expect(failed.phases[0]).toBe("failed");
    expect(
      effectiveSetupProgress(
        state({ status: "blocked", message: "remote.error.denied" }),
        "connecting",
      ).phases[0],
    ).toBe("running");
    expect(
      effectiveSetupProgress(state({ status: "ended" }), "exited").phases[0],
    ).toBe("running");
  });

  it("selects a marked phase, next pending phase, or the end", () => {
    expect(
      shownPhaseIndex({
        ...INITIAL_SETUP_PROGRESS,
        phases: ["done", "waiting", "pending"],
      }),
    ).toBe(1);
    expect(
      shownPhaseIndex({
        ...INITIAL_SETUP_PROGRESS,
        phases: ["done", "skipped", "pending"],
      }),
    ).toBe(2);
    expect(
      shownPhaseIndex({
        ...INITIAL_SETUP_PROGRESS,
        phases: SETUP_PHASES.map(() => "done"),
      }),
    ).toBe(SETUP_PHASES.length);
  });
});

it("selects screen reader mode based on the latest interaction", () => {
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(resolveScreenReaderMode()).toBe(false);
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  expect(resolveScreenReaderMode()).toBe(true);
});
