/**
 * Reads the `owner/name` path from a GitHub repository address.
 *
 * @param repoUrl - Repository address such as https://github.com/owner/name.git.
 * @returns The `owner/name` path, or null when the address is not a GitHub repository.
 */
export function extractRepoName(repoUrl: string): string | null {
  const match = repoUrl.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(\.git)?\/?$/,
  );

  return match?.[1] ?? null;
}
