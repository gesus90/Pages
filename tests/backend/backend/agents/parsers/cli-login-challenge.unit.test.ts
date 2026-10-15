import { describe, expect, it } from "vitest";

import {
  readClaudeChallenge,
  readCodexChallenge,
} from "@/backend/agents/cli/CliLoginParser";

const ESC = "\u001b";
const CODEX_OUTPUT = [
  "Welcome to Codex [v0.50.0]",
  "Follow these steps to sign in with ChatGPT using device code authorization:",
  "",
  "1. Open this link in your browser and sign in to your account",
  `   ${ESC}[94mhttps://auth.openai.com/codex/device${ESC}[0m`,
  "",
  "2. Enter this one-time code (expires in 15 minutes)",
  `   ${ESC}[94mABCD-12345${ESC}[0m`,
  "",
].join("\n");

describe("readCodexChallenge", () => {
  it("extracts the device URL and code from coloured terminal output", () => {
    expect(readCodexChallenge(CODEX_OUTPUT)).toEqual({
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-12345",
    });
  });

  it("picks the genuine URL when a decoy link comes first", () => {
    const output = `See https://example.test/help for details\n${CODEX_OUTPUT}`;
    expect(readCodexChallenge(output)?.verificationUrl).toBe(
      "https://auth.openai.com/codex/device",
    );
  });

  it.each([
    ["a look-alike host", "https://auth.openai.com.attacker.test/codex/device"],
    [
      "user info before the host",
      "https://auth.openai.com@attacker.test/codex/device",
    ],
    ["another port", "https://auth.openai.com:8443/codex/device"],
    ["a query string", "https://auth.openai.com/codex/device?next=evil"],
    ["a fragment", "https://auth.openai.com/codex/device#frag"],
    ["a longer path", "https://auth.openai.com/codex/device/extra"],
    ["a trailing full stop", "https://auth.openai.com/codex/device."],
    ["plain http", "http://auth.openai.com/codex/device"],
  ])("refuses %s", (_, url) => {
    expect(readCodexChallenge(`${url}\nABCD-1234\n`)).toBeNull();
  });

  it.each([
    ["no code", ""],
    ["a lower-case code", "abcd-1234"],
    ["a code that is too short", "ABC-1234"],
    ["a code that is too long", "ABCD-1234567"],
    ["a code glued to other text", "XABCD-1234Y"],
  ])("refuses output with %s", (_, code) => {
    const output = `https://auth.openai.com/codex/device\n${code}\n`;
    expect(readCodexChallenge(output)).toBeNull();
  });

  it("accepts the shortest and longest documented code form", () => {
    const base = "https://auth.openai.com/codex/device";
    expect(readCodexChallenge(`${base}\nAB12-CD34\n`)?.userCode).toBe(
      "AB12-CD34",
    );
    expect(readCodexChallenge(`${base}\nAB12-CD3456\n`)?.userCode).toBe(
      "AB12-CD3456",
    );
  });

  it("returns null for empty output", () => {
    expect(readCodexChallenge("")).toBeNull();
  });
});

const CLAUDE_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=synthetic" +
  "&response_type=code" +
  "&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback" +
  "&scope=user%3Ainference&code_challenge=abc123&code_challenge_method=S256" +
  "&state=xyz";

describe("readClaudeChallenge", () => {
  it("accepts Anthropic's PKCE authorization page", () => {
    const output = `Opening browser to sign in…\nIf the browser did not open, visit:\n${ESC}[4m${CLAUDE_URL}${ESC}[24m\n`;
    expect(readClaudeChallenge(output)).toEqual({
      verificationUrl: CLAUDE_URL,
    });
  });

  it("never reports a user code", () => {
    expect(readClaudeChallenge(CLAUDE_URL)).not.toHaveProperty("userCode");
  });

  it.each([
    ["another origin", CLAUDE_URL.replace("claude.com", "claude.ai")],
    [
      "a look-alike host",
      CLAUDE_URL.replace("claude.com", "claude.com.evil.test"),
    ],
    ["another path", CLAUDE_URL.replace("/cai/oauth/authorize", "/login")],
    [
      "another redirect target",
      CLAUDE_URL.replace("platform.claude.com", "evil.test"),
    ],
    ["a plain challenge method", CLAUDE_URL.replace("S256", "plain")],
    ["user info", CLAUDE_URL.replace("https://", "https://user:pw@")],
    [
      "a missing challenge method",
      CLAUDE_URL.split("&code_challenge_method")[0],
    ],
  ])("refuses %s", (_, url) => {
    expect(readClaudeChallenge(url)).toBeNull();
  });

  it("refuses a URL that the terminal wrapped across lines", () => {
    const wrapped = `${CLAUDE_URL.slice(0, 120)}\n${CLAUDE_URL.slice(120)}`;
    expect(readClaudeChallenge(wrapped)).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(readClaudeChallenge("")).toBeNull();
  });
});
