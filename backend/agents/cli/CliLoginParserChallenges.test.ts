import { describe, expect, it, vi } from "vitest";

import {
  readAntigravityChallenge,
  readAntigravityLoopback,
  readClaudeChallenge,
  readCodexChallenge,
} from "@/backend/agents/cli/CliLoginParser";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const CODEX_URL = "https://auth.openai.com/codex/device";

describe("readCodexChallenge", () => {
  it("reads the device URL and the code, ignoring terminal control codes", () => {
    expect(
      readCodexChallenge(`\u001b[94m${CODEX_URL}\u001b[0m\n  ABCD-EFGH12\n`),
    ).toEqual({ verificationUrl: CODEX_URL, userCode: "ABCD-EFGH12" });
  });

  it("finds a code at the very start of the output", () => {
    expect(readCodexChallenge(`ABCD-EFGH ${CODEX_URL}`)).toEqual({
      verificationUrl: CODEX_URL,
      userCode: "ABCD-EFGH",
    });
  });

  it.each([
    ["no link at all", "ABCD-EFGH"],
    ["no code", CODEX_URL],
    ["no output", ""],
    ["another host", "https://evil.example/codex/device ABCD-EFGH"],
    ["another path", "https://auth.openai.com/other ABCD-EFGH"],
    ["a query", `${CODEX_URL}?next=1 ABCD-EFGH`],
    ["a fragment", `${CODEX_URL}#frag ABCD-EFGH`],
    ["a user name", "https://user@auth.openai.com/codex/device ABCD-EFGH"],
    ["a password", "https://:secret@auth.openai.com/codex/device ABCD-EFGH"],
  ])("rejects %s", (name, output) => {
    expect(readCodexChallenge(output)).toBeNull();
  });
});

const CLAUDE_BASE = "https://claude.com/cai/oauth/authorize";
const CLAUDE_QUERY =
  "redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge_method=S256";

describe("readClaudeChallenge", () => {
  it("accepts the PKCE authorization page", () => {
    const url = `${CLAUDE_BASE}?${CLAUDE_QUERY}&state=x`;

    expect(readClaudeChallenge(`Open ${url}\n`)).toEqual({
      verificationUrl: url,
    });
  });

  it.each([
    [
      "another host",
      `https://evil.example/cai/oauth/authorize?${CLAUDE_QUERY}`,
    ],
    ["another path", `https://claude.com/other?${CLAUDE_QUERY}`],
    ["a user name", `https://u@claude.com/cai/oauth/authorize?${CLAUDE_QUERY}`],
    ["a password", `https://:p@claude.com/cai/oauth/authorize?${CLAUDE_QUERY}`],
    [
      "another redirect",
      `${CLAUDE_BASE}?redirect_uri=https%3A%2F%2Fevil.example&code_challenge_method=S256`,
    ],
    [
      "no S256 challenge",
      `${CLAUDE_BASE}?redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback`,
    ],
    ["no query", CLAUDE_BASE],
  ])("rejects %s", (name, output) => {
    expect(readClaudeChallenge(output)).toBeNull();
  });
});

const GOOGLE_BASE = "https://accounts.google.com/o/oauth2/v2/auth";

function googleUrl(
  parameters: Readonly<Record<string, string>>,
  base = GOOGLE_BASE,
): string {
  return `${base}?${new URLSearchParams(parameters)}`;
}

const loopback = {
  response_type: "code",
  state: "abc",
  redirect_uri: "http://127.0.0.1:4242/",
  code_challenge_method: "S256",
  code_challenge: "challenge",
};

describe("readAntigravityChallenge", () => {
  it("accepts the loopback callback on both authorization paths", () => {
    const first = googleUrl(loopback);
    const second = googleUrl(
      loopback,
      "https://accounts.google.com/o/oauth2/auth",
    );

    expect(readAntigravityChallenge(first)).toEqual({ verificationUrl: first });
    expect(readAntigravityChallenge(second)).toEqual({
      verificationUrl: second,
    });
  });

  it("accepts the hosted callback with a PKCE challenge", () => {
    const url = googleUrl({
      ...loopback,
      redirect_uri: "https://antigravity.google/oauth-callback",
    });

    expect(readAntigravityChallenge(url)).toEqual({ verificationUrl: url });
  });

  it.each([
    ["another host", googleUrl(loopback, "https://evil.example/o/oauth2/auth")],
    ["another path", googleUrl(loopback, "https://accounts.google.com/other")],
    [
      "a user name",
      googleUrl(loopback, "https://u@accounts.google.com/o/oauth2/auth"),
    ],
    [
      "a password",
      googleUrl(loopback, "https://:p@accounts.google.com/o/oauth2/auth"),
    ],
    ["a fragment", `${googleUrl(loopback)}#frag`],
    [
      "another response type",
      googleUrl({ ...loopback, response_type: "token" }),
    ],
    ["no state", googleUrl({ ...loopback, state: "" })],
    [
      "an unknown redirect",
      googleUrl({ ...loopback, redirect_uri: "https://evil.example/" }),
    ],
    [
      "a hosted callback without S256",
      googleUrl({
        ...loopback,
        redirect_uri: "https://antigravity.google/oauth-callback",
        code_challenge_method: "plain",
      }),
    ],
    [
      "a hosted callback without a challenge",
      googleUrl({
        ...loopback,
        redirect_uri: "https://antigravity.google/oauth-callback",
        code_challenge: "",
      }),
    ],
  ])("rejects %s", (name, output) => {
    expect(readAntigravityChallenge(output)).toBeNull();
  });

  it.each([
    ["a missing redirect", { redirect_uri: "" }],
    ["a malformed redirect", { redirect_uri: "not a url" }],
    ["a TLS redirect", { redirect_uri: "https://127.0.0.1:4242/" }],
    ["another host", { redirect_uri: "http://localhost:4242/" }],
    ["no port", { redirect_uri: "http://127.0.0.1/" }],
    ["another path", { redirect_uri: "http://127.0.0.1:4242/cb" }],
    ["a query", { redirect_uri: "http://127.0.0.1:4242/?a=1" }],
    ["a fragment", { redirect_uri: "http://127.0.0.1:4242/#a" }],
    ["a user name", { redirect_uri: "http://u@127.0.0.1:4242/" }],
    ["a password", { redirect_uri: "http://:p@127.0.0.1:4242/" }],
  ])("rejects a loopback with %s", (name, override) => {
    expect(
      readAntigravityChallenge(googleUrl({ ...loopback, ...override })),
    ).toBeNull();
  });

  it("rejects a loopback URL without any redirect parameter", () => {
    const { state, response_type: responseType } = loopback;

    expect(
      readAntigravityChallenge(
        googleUrl({ state, response_type: responseType }),
      ),
    ).toBeNull();
  });
});

describe("readAntigravityLoopback", () => {
  it("names the port and state of a PKCE loopback", () => {
    expect(readAntigravityLoopback(googleUrl(loopback))).toEqual({
      port: 4242,
      state: "abc",
    });
  });

  it("rejects what the challenge reader rejects", () => {
    expect(readAntigravityLoopback("https://evil.example/")).toBeNull();
  });

  it("rejects a hosted callback, which has no loopback port", () => {
    expect(
      readAntigravityLoopback(
        googleUrl({
          ...loopback,
          redirect_uri: "https://antigravity.google/oauth-callback",
        }),
      ),
    ).toBeNull();
  });

  it("rejects a repeated state", () => {
    expect(
      readAntigravityLoopback(`${googleUrl(loopback)}&state=other`),
    ).toBeNull();
  });

  it("rejects a loopback without S256", () => {
    expect(
      readAntigravityLoopback(
        googleUrl({ ...loopback, code_challenge_method: "plain" }),
      ),
    ).toBeNull();
  });

  it("rejects a loopback without a challenge", () => {
    expect(
      readAntigravityLoopback(googleUrl({ ...loopback, code_challenge: "" })),
    ).toBeNull();
  });
});
