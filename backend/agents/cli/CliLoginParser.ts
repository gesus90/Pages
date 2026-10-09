import { stripVTControlCharacters } from "node:util";

import type { CliLoginChallenge } from "./CliContracts";

function readUrls(output: string): URL[] {
  const urls: URL[] = [];
  for (const candidate of stripVTControlCharacters(output).match(
    /https:\/\/[^\s<>"']+/g,
  ) ?? []) {
    try {
      urls.push(new URL(candidate));
    } catch {
      continue;
    }
  }
  return urls;
}

/** Extracts only the documented OpenAI device URL and a short one-time code. */
export function readCodexChallenge(output: string): CliLoginChallenge | null {
  const url = readUrls(output).find(
    (candidate) =>
      candidate.origin === "https://auth.openai.com" &&
      candidate.pathname === "/codex/device" &&
      !candidate.search &&
      !candidate.hash &&
      !candidate.username &&
      !candidate.password,
  );
  const match = stripVTControlCharacters(output).match(
    /(?:^|\s)([A-Z0-9]{4}-[A-Z0-9]{4,6})(?=\s|$)/,
  );
  return url && match
    ? { verificationUrl: url.href, userCode: match[1] }
    : null;
}

/** Allows only Anthropic's own PKCE authorization page and code callback. */
export function readClaudeChallenge(output: string): CliLoginChallenge | null {
  const url = readUrls(output).find(
    (candidate) =>
      candidate.origin === "https://claude.com" &&
      candidate.pathname === "/cai/oauth/authorize" &&
      !candidate.username &&
      !candidate.password &&
      candidate.searchParams.get("redirect_uri") ===
        "https://platform.claude.com/oauth/code/callback" &&
      candidate.searchParams.get("code_challenge_method") === "S256",
  );
  return url ? { verificationUrl: url.href } : null;
}
