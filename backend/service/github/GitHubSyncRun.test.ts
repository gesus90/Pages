import { describe, expect, it } from "vitest";

import {
  canPullFromGitHub,
  canPushToGitHub,
  createEmptySyncCounters,
} from "./GitHubSyncRun";

import type { ProjectIntegration } from "@/definition/Project";

function integration(
  syncDirection: ProjectIntegration["syncDirection"],
): ProjectIntegration {
  return { syncDirection } as unknown as ProjectIntegration;
}

describe("createEmptySyncCounters", () => {
  it("starts every counter at zero and returns a fresh object", () => {
    const counters = createEmptySyncCounters();

    expect(counters).toEqual({
      conflicts: 0,
      created: 0,
      detected: 0,
      pulled: 0,
      pullRequests: 0,
      pushed: 0,
    });
    expect(createEmptySyncCounters()).not.toBe(counters);
  });
});

describe("sync direction", () => {
  it("lets bidirectional integrations push and pull", () => {
    expect(canPushToGitHub(integration("bidirectional"))).toBe(true);
    expect(canPullFromGitHub(integration("bidirectional"))).toBe(true);
  });

  it("lets push integrations only push", () => {
    expect(canPushToGitHub(integration("push"))).toBe(true);
    expect(canPullFromGitHub(integration("push"))).toBe(false);
  });

  it("lets pull integrations only pull", () => {
    expect(canPushToGitHub(integration("pull"))).toBe(false);
    expect(canPullFromGitHub(integration("pull"))).toBe(true);
  });
});
