import { stripVTControlCharacters } from "node:util";

import { logCaughtError } from "@/backend/logging/Logger";

import type { CliLoginChallenge } from "./CliContracts";

function readUrls(output: string): URL[] {
  const urls: URL[] = [];
  for (const candidate of stripVTControlCharacters(output).match(
    /https:\/\/[^\s<>"']+/g,
  ) ?? []) {
    try {
      urls.push(new URL(candidate));
    } catch (caughtError: unknown) {
      logCaughtError("CliLoginParser", caughtError);

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

function hasLoopbackCallback(candidate: URL): boolean {
  try {
    const redirect = new URL(candidate.searchParams.get("redirect_uri") ?? "");
    return (
      redirect.protocol === "http:" &&
      redirect.hostname === "127.0.0.1" &&
      Number(redirect.port) > 0 &&
      redirect.pathname === "/" &&
      !redirect.search &&
      !redirect.hash &&
      !redirect.username &&
      !redirect.password
    );
  } catch {
    return false;
  }
}

/** Accepts only Google's authorization URL with the adapter-owned loopback callback. */
export function readAntigravityChallenge(
  output: string,
): CliLoginChallenge | null {
  const url = readUrls(output).find(
    (candidate) =>
      candidate.origin === "https://accounts.google.com" &&
      ["/o/oauth2/auth", "/o/oauth2/v2/auth"].includes(candidate.pathname) &&
      !candidate.username &&
      !candidate.password &&
      !candidate.hash &&
      candidate.searchParams.get("response_type") === "code" &&
      Boolean(candidate.searchParams.get("state")) &&
      hasLoopbackCallback(candidate),
  );
  return url ? { verificationUrl: url.href } : null;
}
