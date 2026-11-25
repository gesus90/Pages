import { describe, expect, it } from "vitest";

import {
  gitHubCreationKey,
  gitHubCreationMarker,
  preserveGitHubCreationMarker,
  withoutGitHubCreationMarker,
} from "./GitHubCreationIdentity";

const KEY = "a".repeat(64);

describe("gitHubCreationKey", () => {
  it("derives a stable sha256 hex key per repository and task", () => {
    const key = gitHubCreationKey("owner/repo", "task-1");

    expect(key).toMatch(/^[a-f0-9]{64}$/u);
    expect(gitHubCreationKey("owner/repo", "task-1")).toBe(key);
    expect(gitHubCreationKey("owner/other", "task-1")).not.toBe(key);
    expect(gitHubCreationKey("owner/repo", "task-2")).not.toBe(key);
  });
});

describe("gitHubCreationMarker", () => {
  it("renders the marker as a trailing html comment", () => {
    expect(gitHubCreationMarker(KEY)).toBe(
      `\n\n<!-- pages-creation:${KEY} -->`,
    );
  });
});

describe("withoutGitHubCreationMarker", () => {
  it("removes a trailing marker", () => {
    expect(
      withoutGitHubCreationMarker(`Text${gitHubCreationMarker(KEY)}`),
    ).toBe("Text");
  });

  it("keeps a body without a marker", () => {
    expect(withoutGitHubCreationMarker("Text")).toBe("Text");
  });
});

describe("preserveGitHubCreationMarker", () => {
  it("appends the marker of the previous body", () => {
    expect(
      preserveGitHubCreationMarker("New", `Old${gitHubCreationMarker(KEY)}`),
    ).toBe(`New${gitHubCreationMarker(KEY)}`);
  });

  it("appends nothing when the previous body has no marker", () => {
    expect(preserveGitHubCreationMarker("New", "Old")).toBe("New");
  });
});
