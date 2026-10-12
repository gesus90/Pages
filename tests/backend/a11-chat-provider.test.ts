import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTextExecution } from "@/backend/agents/AgentTextExecution";
import { AgentCliRuntime } from "@/backend/agents/cli/AgentCliRuntime";
import { AgentCredentialStore } from "@/backend/agents/cli/AgentCredentialStore";
import { CliLocator } from "@/backend/agents/cli/CliLocator";
import { CliProcessRunner } from "@/backend/agents/cli/CliProcessRunner";
import { CliTextExecution } from "@/backend/agents/cli/CliTextExecution";
import { readCliTextResponse } from "@/backend/agents/cli/CliTextResponse";
import {
  createTextProviderRequest,
  readTextProviderResponse,
} from "@/backend/agents/providers/TextProviderPayload";
import { AgentOperationRegistry } from "@/backend/service/agents/AgentOperationRegistry";
import { canChatSearchWeb } from "@/definition/Chat";

import { CLI_HOME, completeCli, createCliSpawn } from "../helpers/agent-cli";

import type { CliToolAdapter } from "@/backend/agents/cli/CliContracts";
import type {
  TextExecution,
  TextExecutionInput,
} from "@/backend/agents/TextExecution";
import type {
  AgentProviderId,
  ApiProviderId,
  CliProviderId,
} from "@/definition/AgentConnection";

function chatInput(
  provider: AgentProviderId,
  webSearch: boolean,
): TextExecutionInput {
  return {
    instructions: "# Pica\n\nDu bist Pica.",
    userId: "person",
    prompt: 'Aktuelle Nachricht der Person: "Hallo"',
    webSearch,
    agent: {
      model: "chat-model",
      reasoningEffort: "medium",
      connection: {
        isActive: true,
        id: path.basename(CLI_HOME.root),
        name: "Chat",
        provider,
        hasApiKey: true,
        testModel: null,
        reasoningEffort: null,
        cliLoggedInAt: "2026-10-12T08:00:00Z",
        cliAccountLabel: null,
        updatedAt: "now",
      },
    },
  };
}

describe("A11.4 T6.12.6: provider search and system instruction", () => {
  it("offers search for every provider with an own search function, but not for Z.ai", () => {
    for (const provider of [
      "openai",
      "anthropic",
      "google_ai_studio",
      "openrouter",
      "codex_cli",
      "claude_code",
    ] as const)
      expect(canChatSearchWeb(provider)).toBe(true);
    expect(canChatSearchWeb("zai")).toBe(false);
  });

  it("builds each provider's own search tool next to the separate instruction", () => {
    const request = (provider: ApiProviderId, webSearch = true) =>
      createTextProviderRequest(provider, chatInput(provider, webSearch));
    expect(request("openai")).toEqual({
      path: "/responses",
      body: {
        model: "chat-model",
        instructions: "# Pica\n\nDu bist Pica.",
        input: 'Aktuelle Nachricht der Person: "Hallo"',
        tools: [{ type: "web_search" }],
        max_output_tokens: 16_384,
        store: false,
        reasoning: { effort: "medium" },
      },
    });
    expect(request("openai", false)).toMatchObject({
      path: "/chat/completions",
      body: {
        messages: [
          { role: "system", content: "# Pica\n\nDu bist Pica." },
          { role: "user", content: 'Aktuelle Nachricht der Person: "Hallo"' },
        ],
      },
    });
    expect(request("anthropic").body).toMatchObject({
      system: "# Pica\n\nDu bist Pica.",
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    });
    expect(request("google_ai_studio").body).toMatchObject({
      systemInstruction: { parts: [{ text: "# Pica\n\nDu bist Pica." }] },
      tools: [{ google_search: {} }],
    });
    expect(request("openrouter").body).toMatchObject({
      plugins: [{ id: "web" }],
      provider: { allow_fallbacks: false },
    });
    expect(request("zai").body).not.toHaveProperty("tools");
    expect(request("zai").body).not.toHaveProperty("plugins");
    expect(request("anthropic", false).body).not.toHaveProperty("tools");
  });

  it("reads answers that used the provider's search and rejects refusals, truncation and client tools", () => {
    const search = { webSearch: true } as const;
    expect(
      readTextProviderResponse(
        "openai",
        {
          status: "completed",
          output: [
            { type: "reasoning", summary: [] },
            { type: "web_search_call", status: "completed" },
            {
              type: "message",
              content: [
                { type: "output_text", text: "Laut Quelle " },
                { type: "output_text", text: "regnet es." },
              ],
            },
          ],
        },
        search,
      ),
    ).toBe("Laut Quelle regnet es.");
    for (const payload of [
      { status: "incomplete", output: [] },
      { status: "completed", output: [{ type: "function_call" }] },
      {
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
        ],
      },
      { status: "completed", output: null },
    ])
      expect(() => readTextProviderResponse("openai", payload, search)).toThrow(
        "invalidOutput",
      );
    expect(
      readTextProviderResponse(
        "anthropic",
        {
          stop_reason: "end_turn",
          content: [
            { type: "server_tool_use", name: "web_search" },
            { type: "web_search_tool_result", content: [] },
            { type: "text", text: "Es regnet." },
          ],
        },
        search,
      ),
    ).toBe("Es regnet.");
    expect(() =>
      readTextProviderResponse(
        "anthropic",
        { stop_reason: "end_turn", content: [{ type: "tool_use", name: "x" }] },
        search,
      ),
    ).toThrow("invalidOutput");
    expect(() =>
      readTextProviderResponse(
        "anthropic",
        { stop_reason: "end_turn", content: null },
        search,
      ),
    ).toThrow("invalidOutput");
  });
});

describe("A11.4 T6.12.5: CLI chat runs", () => {
  let directory = "";
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pages-chat-cli-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function setup(provider: CliProviderId) {
    const store = new AgentCredentialStore(directory);
    const locator = new CliLocator("/synthetic/none", "/synthetic/node");
    vi.spyOn(locator, "find").mockResolvedValue({
      found: true,
      path: "/synthetic/binary",
    });
    const fake = createCliSpawn();
    const runner = new CliProcessRunner(fake);
    const runtime = new AgentCliRuntime({ store, locator, runner });
    const adapter: CliToolAdapter = {
      provider,
      readStatus: vi.fn().mockResolvedValue({
        outcome: { ok: true, detail: {} },
        accountLabel: null,
      }),
      version: vi.fn(),
      startLogin: vi.fn(),
      loginError: vi.fn(),
      runTest: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    vi.spyOn(runtime, "adapter").mockResolvedValue(adapter);
    return {
      fake,
      execution: new CliTextExecution({ store, locator, runner, runtime }),
    };
  }

  it.each([true, false])(
    "lets Codex search only for the chat (search %s), with no shell, files or MCP",
    async (webSearch) => {
      const { fake, execution } = setup("codex_cli");
      const pending = execution.run(
        chatInput("codex_cli", webSearch),
        new AbortController().signal,
      );
      await vi.waitFor(() => expect(fake.children).toHaveLength(1));
      const child = fake.children[0];
      if (child.stdin instanceof PassThrough)
        expect(child.stdin.read().toString()).toBe(
          '# Pica\n\nDu bist Pica.\n\nAktuelle Nachricht der Person: "Hallo"',
        );
      const [, args] = fake.spawn.mock.calls[0];
      expect(args).toContain(
        webSearch ? 'web_search="live"' : 'web_search="disabled"',
      );
      for (const locked of [
        "read-only",
        "features.shell_tool=false",
        "features.apply_patch_freeform=false",
        "mcp_servers={}",
      ])
        expect(args).toContain(locked);
      completeCli(
        child,
        [
          { type: "item.completed", item: { type: "web_search", query: "x" } },
          {
            type: "item.completed",
            item: { type: "agent_message", text: "Antwort" },
          },
          { type: "turn.completed" },
        ]
          .map((entry) => JSON.stringify(entry))
          .join("\n"),
      );
      if (webSearch) await expect(pending).resolves.toBe("Antwort");
      else await expect(pending).rejects.toThrow("invalidOutput");
    },
  );

  it("enables only Claude Code's web search, with turns for the search", async () => {
    const { fake, execution } = setup("claude_code");
    const pending = execution.run(
      chatInput("claude_code", true),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(fake.children).toHaveLength(1));
    const [, args] = fake.spawn.mock.calls[0];
    const tools = args.indexOf("--tools");
    expect(args.slice(tools, tools + 4)).toEqual([
      "--tools",
      "WebSearch",
      "--allowedTools",
      "WebSearch",
    ]);
    expect(args[args.indexOf("--max-turns") + 1]).toBe("6");
    completeCli(
      fake.children[0],
      JSON.stringify({
        is_error: false,
        subtype: "success",
        result: "Antwort",
      }),
    );
    await expect(pending).resolves.toBe("Antwort");
    expect(() =>
      readCliTextResponse(
        "codex_cli",
        JSON.stringify({
          type: "item.started",
          item: { type: "command_execution" },
        }),
        { webSearch: true },
      ),
    ).toThrow("invalidOutput");
  });
});

describe("A11.4: parallel chats on one connection", () => {
  it("shares a verified connection between chats while text runs stay exclusive", async () => {
    let finish: (text: string) => void = () => undefined;
    const slow: TextExecution = {
      run: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const operations = new AgentOperationRegistry();
    const input = chatInput("openai", true);
    const signal = new AbortController().signal;
    const chat = new AgentTextExecution(slow, slow, operations, "shared");
    const first = chat.run(input, signal);
    const second = chat.run(input, signal);
    await vi.waitFor(() => expect(slow.run).toHaveBeenCalledTimes(2));
    // Running chats still keep logins and credential changes away.
    expect(() =>
      operations.acquire(input.agent.connection.id, "login"),
    ).toThrow();
    finish("eins");
    expect(await Promise.race([first, second])).toBe("eins");

    const exclusive = new AgentTextExecution(
      slow,
      slow,
      new AgentOperationRegistry(),
    );
    const running = exclusive.run(input, signal);
    await expect(exclusive.run(input, signal)).rejects.toThrow();
    finish("zwei");
    await expect(running).resolves.toBe("zwei");
  });
});
