import { createHash } from "node:crypto";

const MARKER_PATTERN = /\n\n<!-- pages-creation:[a-f0-9]{64} -->$/u;

/** Stable identity for one task in one remote repository; it discloses no local identifier. */
export function gitHubCreationKey(repository: string, taskId: string): string {
  return createHash("sha256").update(`${repository}\n${taskId}`).digest("hex");
}

/** Marker recovered from GitHub after losing a create acknowledgement. */
export function gitHubCreationMarker(key: string): string {
  return `\n\n<!-- pages-creation:${key} -->`;
}

/** Excludes transport identity from content comparison and imported descriptions. */
export function withoutGitHubCreationMarker(body: string): string {
  return body.replace(MARKER_PATTERN, "");
}

/** Keeps an existing creation marker when changing user-authored issue content. */
export function preserveGitHubCreationMarker(
  body: string,
  previous: string,
): string {
  return body + (previous.match(MARKER_PATTERN)?.[0] ?? "");
}
