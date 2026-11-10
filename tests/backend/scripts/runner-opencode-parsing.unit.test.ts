import { hostname } from "node:os";

import { expect, it, describe } from "vitest";

import { MODULE_FILE, line, load } from "./runner-opencode-harness";

describe("environment, constants and small projections", () => {
  it("disables autoupdate and sharing by default and honours a given configuration", async () => {
    const { openCodeEnvironment, VERIFIED_OPENCODE_VERSION } = await load();
    expect(VERIFIED_OPENCODE_VERSION).toBe("1.18.34");
    const base = { PATH: "/bin", OPENCODE_DISABLE_AUTOUPDATE: "0" };
    const environment = openCodeEnvironment(base);
    expect(environment.PATH).toBe("/bin");
    expect(environment.OPENCODE_DISABLE_AUTOUPDATE).toBe("1");
    expect(JSON.parse(environment.OPENCODE_CONFIG_CONTENT ?? "")).toEqual({
      share: "disabled",
      autoupdate: false,
    });
    expect(base.OPENCODE_DISABLE_AUTOUPDATE).toBe("0");
    expect(
      JSON.parse(
        openCodeEnvironment(base, { model: "a/b" }).OPENCODE_CONFIG_CONTENT ??
          "",
      ),
    ).toEqual({ model: "a/b" });
  });

  it("projects the final answer from the last stdout line and keeps failures a stable code", async () => {
    const { openCodeResult } = await load();
    expect(
      openCodeResult(
        `${line({ type: "pages.update" })}${line({ type: "pages.result", answer: "Done" })}`,
      ),
    ).toEqual({ answer: "Done", failureCode: undefined });
    expect(
      openCodeResult(line({ error: "provider_auth_failed", answer: 5 })),
    ).toEqual({ answer: "", failureCode: "provider_auth_failed" });
    expect(openCodeResult(line({ error: 7 }))).toEqual({
      answer: "",
      failureCode: undefined,
    });
    expect(openCodeResult("not json")).toEqual({
      answer: "",
      failureCode: undefined,
    });
    expect(openCodeResult("")).toEqual({ answer: "", failureCode: undefined });
  });

  it("names the module as the ACP command and builds the remote banner", async () => {
    const { openCodeCommand, remoteBanner } = await load();
    expect(openCodeCommand()).toEqual([MODULE_FILE, "--acp"]);
    expect(remoteBanner("/work/space")).toBe(
      `Remote host: ${hostname()}\nRemote workspace: /work/space\n\n`,
    );
  });
});

describe("classifyOpenCodeFailure", () => {
  it.each([
    ["FreeTierError: nope", "opencode_free_tier_refused"],
    ["the free tier can only be used with X", "opencode_free_tier_refused"],
    ["HTTP 401", "provider_auth_failed"],
    ["Invalid API key supplied", "provider_auth_failed"],
    ["invalid_key", "provider_auth_failed"],
    ["Unauthorized", "provider_auth_failed"],
    ["authentication required", "provider_auth_failed"],
    ["ProviderAuthError", "provider_auth_failed"],
    ["status 402", "provider_quota_exhausted"],
    ["insufficient credits left", "provider_quota_exhausted"],
    ["Insufficient_balance", "provider_quota_exhausted"],
    ["your quota was exhausted today", "provider_quota_exhausted"],
    ["Payment required", "provider_quota_exhausted"],
    ["usage limit reached", "provider_quota_exhausted"],
    ["please recharge", "provider_quota_exhausted"],
    ["429 too many", "provider_rate_limited"],
    ["Rate-limit hit", "provider_rate_limited"],
    ["ProviderModelNotFoundError", "provider_model_not_found"],
    ["ModelNotFoundError", "provider_model_not_found"],
    ["the model x is not available", "provider_model_not_found"],
    ["404", "provider_model_not_found"],
    ["403", "provider_permission_denied"],
    ["Forbidden", "provider_permission_denied"],
    ["error 500", "provider_unavailable"],
    ["502 bad gateway", "provider_unavailable"],
    ["503", "provider_unavailable"],
    ["504", "provider_unavailable"],
    ["Service Unavailable", "provider_unavailable"],
    ["provider unavailable", "provider_unavailable"],
    ["fetch failed", "provider_unreachable"],
    ["connect ECONNREFUSED 127.0.0.1", "provider_unreachable"],
    ["ENOTFOUND host", "provider_unreachable"],
    ["network error", "provider_unreachable"],
    ["something else entirely", "opencode_acp_session_failed"],
    ["", "opencode_acp_session_failed"],
  ])("classifies %j as %s", async (text, code) => {
    const { classifyOpenCodeFailure } = await load();
    expect(classifyOpenCodeFailure(text)).toBe(code);
  });

  it("prefers the earlier rule when several statements match", async () => {
    const { classifyOpenCodeFailure } = await load();
    expect(classifyOpenCodeFailure("401 and 429")).toBe("provider_auth_failed");
    expect(classifyOpenCodeFailure("429 then 503")).toBe(
      "provider_rate_limited",
    );
  });
});

describe("readOpenCodeListing", () => {
  const entry = (id: string, body: unknown): string =>
    `${id}\n${JSON.stringify(body, null, 2)}\n`;

  it("reads names, efforts, status, outputs, tool support and free cost", async () => {
    const { readOpenCodeListing } = await load();
    const listing =
      entry("openai/gpt-5", {
        name: "GPT 5",
        variants: { high: {}, low: {}, "Bad Effort": {}, "1x": {} },
        status: "active",
        capabilities: {
          toolcall: true,
          output: { text: true, image: false, audio: true, other: true },
        },
        cost: { input: 0, output: 0 },
      }) +
      entry("anthropic/claude-x", {
        name: "bad\u0007name",
        status: "s".repeat(41),
        capabilities: { toolcall: "yes", output: "text" },
        cost: { input: 1, output: 0 },
      }) +
      entry("local/plain", { name: "Plain" }) +
      entry("local/nameless", { capabilities: {} });
    expect(readOpenCodeListing(listing)).toEqual([
      {
        id: "openai/gpt-5",
        name: "GPT 5",
        reasoningEfforts: ["high", "low"],
        status: "active",
        outputs: ["text", "audio"],
        toolCall: true,
        isFree: true,
      },
      {
        id: "anthropic/claude-x",
        name: "anthropic/claude-x",
        reasoningEfforts: [],
        isFree: false,
      },
      {
        id: "local/plain",
        name: "Plain",
        reasoningEfforts: [],
        isFree: false,
      },
      {
        id: "local/nameless",
        name: "local/nameless",
        reasoningEfforts: [],
        isFree: false,
      },
    ]);
  });

  it("skips invalid identifiers, providers and malformed JSON without stopping", async () => {
    const { readOpenCodeListing } = await load();
    const listing =
      entry("bad id!/x", { name: "A" }) +
      entry("OpenAI/upper", { name: "B" }) +
      `broken/json\n{\n  "name": \n}\n` +
      entry("ok/model", { name: "C", capabilities: { output: {} } });
    expect(readOpenCodeListing(listing)).toEqual([
      {
        id: "ok/model",
        name: "C",
        reasoningEfforts: [],
        outputs: [],
        isFree: false,
      },
    ]);
  });

  it("keeps at most ten efforts and at most one thousand models", async () => {
    const { readOpenCodeListing } = await load();
    const variants = Object.fromEntries(
      Array.from({ length: 14 }, (_, index) => [`level${index}`, {}]),
    );
    const many = Array.from({ length: 1005 }, (_, index) =>
      entry(`p/m${index}`, index === 0 ? { variants } : { name: "n" }),
    ).join("");
    const models = readOpenCodeListing(many);
    expect(models).toHaveLength(1000);
    expect(models[0]).toMatchObject({
      id: "p/m0",
      reasoningEfforts: Array.from(
        { length: 10 },
        (_, index) => `level${index}`,
      ),
    });
    expect(models.at(-1)).toMatchObject({ id: "p/m999" });
    expect(readOpenCodeListing("")).toEqual([]);
  });
});
