import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterEach, vi } from "vitest";

import { createAgentServices } from "@/app/lib/agent-services.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { createChatServices } from "@/app/lib/chat-services.server";
import { createMcpServices } from "@/app/lib/mcp-services.server";
import { action as chatApiAction } from "@/app/routes/chat-api";
import {
  action as agentsAction,
  loader as agentsLoader,
} from "@/app/routes/settings-agents";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { ServerCache } from "@/backend/cache/ServerCache";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import { useMigratedDatabase } from "./test-database";
import { createWikiHarness } from "./wiki-harness";

import type { AgentApplicationServices } from "@/app/lib/agent-services.server";
import type { ChatApplicationServices } from "@/app/lib/chat-services.server";
import type { Database } from "@/backend/database/Database";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentProfileInput } from "@/definition/AgentProfile";
import type { User } from "@/definition/User";

/** Synthetic OpenRouter key; it must never leave the server side. */
export const PICA_SYNTHETIC_KEY =
  "sk-or-v1-page18-synthetic-credential-0f1e2d3c";

/** The answer of the dummy provider; the chat must show exactly this text. */
export const PICA_DUMMY_MARKER = "PICA-DUMMY-MARKER-7F3A";

/** Where the dummy provider answers; every other host is a test failure. */
export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1";

const TOKEN_KEY = Buffer.alloc(32, 7);

/** Provider, model and reasoning effort an administrator chooses for Pica. */
export interface PicaSelection {
  readonly connectionId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** What the dummy provider saw of one request, without the credential itself. */
export interface DummyProviderCall {
  readonly url: string;
  readonly method: string;
  /** Whether the request carried exactly the synthetic key, in its header only. */
  readonly isAuthenticated: boolean;
  readonly body: Readonly<Record<string, unknown>> | null;
}

/** Answers one chat completion request of the dummy provider. */
export type DummyCompletion = (
  body: Readonly<Record<string, unknown>>,
  signal: AbortSignal | null,
) => Response | Promise<Response>;

/** A deterministic OpenRouter: key check, model catalog and chat completions. */
export interface DummyOpenRouter {
  readonly calls: DummyProviderCall[];
  /** Entries of the model listing, changeable to simulate catalog updates. */
  models: readonly Readonly<Record<string, unknown>>[];
  complete: DummyCompletion;
  /** The requests to the chat completion endpoint. */
  completions(): readonly DummyProviderCall[];
  answer(url: string, init: RequestInit): Promise<Response>;
}

/** The real services of the agents panel and the chat, as the routes receive them. */
export type PicaServices = AgentApplicationServices &
  ChatApplicationServices & {
    readonly administrationService: AdministrationService;
    readonly agentPlanService: Pick<AgentPlanService, "taskAssignments">;
  };

/** A route response read as JSON. */
export interface RouteResult {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
  /** The response exactly as the browser receives it. */
  readonly text: string;
}

/** Builds one model entry of OpenRouter's listing. */
export function openRouterModel(
  id: string,
  efforts: readonly string[] | null,
): Readonly<Record<string, unknown>> {
  return {
    id,
    name: id,
    context_length: 262_144,
    pricing: { prompt: "0", completion: "0" },
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
    // An empty object marks a model that reasons without selectable levels.
    reasoning:
      efforts === null
        ? {}
        : { supported_efforts: efforts, default_effort: efforts[0] },
  };
}

/** The listing of the dummy provider; `openrouter/free` becomes the access's test model. */
export const PICA_DUMMY_MODELS = [
  openRouterModel("openrouter/free", ["low", "high"]),
  openRouterModel("vendor/pica-chat", ["medium", "low", "high"]),
  openRouterModel("vendor/pica-other", ["low", "high"]),
  openRouterModel("poolside/laguna-s-2.1:free", null),
] as const;

/** A complete chat completion with the given text. */
export function completion(content: string, finishReason = "stop"): Response {
  return Response.json({
    id: "gen-synthetic",
    choices: [
      {
        finish_reason: finishReason,
        message: { role: "assistant", content, refusal: null },
      },
    ],
  });
}

function readBody(init: RequestInit): Readonly<Record<string, unknown>> | null {
  if (typeof init.body !== "string") return null;
  const body: unknown = JSON.parse(init.body);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Error("The dummy provider expects a JSON object.");
  return Object.fromEntries(Object.entries(body));
}

/** Creates the dummy provider; it never opens a network connection. */
export function createDummyOpenRouter(): DummyOpenRouter {
  const provider: DummyOpenRouter = {
    calls: [],
    models: PICA_DUMMY_MODELS,
    complete: () => completion(PICA_DUMMY_MARKER),
    completions: () =>
      provider.calls.filter((call) => call.url.endsWith("/chat/completions")),
    async answer(url, init) {
      if (!url.startsWith(`${OPENROUTER_ENDPOINT}/`))
        throw new Error(`Unexpected network request to ${url}`);
      const body = readBody(init);
      provider.calls.push({
        url,
        method: init.method ?? "GET",
        isAuthenticated:
          new Headers(init.headers).get("Authorization") ===
          `Bearer ${PICA_SYNTHETIC_KEY}`,
        body,
      });
      const route = url.slice(OPENROUTER_ENDPOINT.length);
      if (route === "/key")
        return Response.json({
          data: { is_free_tier: false, limit_remaining: null },
        });
      if (route.startsWith("/models"))
        return Response.json({ data: provider.models });
      if (route === "/chat/completions")
        return provider.complete(body ?? {}, init.signal ?? null);
      return Response.json({ error: { code: 404 } }, { status: 404 });
    },
  };
  return provider;
}

function routeContext(user: User | null): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(authenticatedUserContext, user);
  return context;
}

async function readRoute(response: Response): Promise<RouteResult> {
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new Error("The route answered without a JSON object.");
  return {
    status: response.status,
    body: Object.fromEntries(Object.entries(body)),
    text,
  };
}

/** Sends one form of the agents panel to the real settings route. */
export async function submitAgentsForm(
  user: User,
  fields: Readonly<Record<string, string>>,
): Promise<RouteResult> {
  const url = "https://pages.invalid/settings/agents";
  return readRoute(
    await agentsAction({
      // Sent as text, so the body reads the same under Node and jsdom.
      request: new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      }),
      context: routeContext(user),
      params: {},
      url: new URL(url),
      pattern: "/settings/agents",
    }),
  );
}

/** Loads the agents panel through the real settings route. */
export async function loadAgentsPanel(user: User): Promise<{
  readonly data: Awaited<ReturnType<typeof agentsLoader>>["data"];
  /** The loader data as it is serialized for the browser. */
  readonly text: string;
}> {
  const url = "https://pages.invalid/settings/agents";
  const result = await agentsLoader({
    request: new Request(url),
    context: routeContext(user),
    params: {},
    url: new URL(url),
    pattern: "/settings/agents",
  });
  return { data: result.data, text: JSON.stringify(result.data) };
}

/** Sends one intent to the real chat route as the given person. */
export async function sendChatIntent(
  user: User | null,
  body: Readonly<Record<string, unknown>>,
): Promise<RouteResult> {
  const url = "https://pages.invalid/chat-api";
  return readRoute(
    await chatApiAction({
      request: new Request(url, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      context: routeContext(user),
      params: {},
      url: new URL(url),
      pattern: "/chat-api",
    }),
  );
}

/** The agent Pica as the agents panel submits it for the system function Chat. */
export function picaProfile(selection: PicaSelection): AgentProfileInput {
  return {
    name: "Pica",
    isActive: true,
    purposes: ["chat"],
    targets: [{ kind: "system", targetId: "chat" }],
    connectionId: selection.connectionId,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    configuration: emptyAgentConfiguration("system"),
  };
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string.");
  return value;
}

/**
 * The settings and chat routes on a real database: an administrator, a
 * person without administration, and the dummy OpenRouter as the only
 * network. Browser requests to `/chat-api` reach the real chat route as the
 * person signed in with {@link PicaApplication.signIn}.
 */
export async function createPicaApplication(
  database: Database,
  options: { readonly chatTimeoutMs?: number } = {},
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pages-pica-"));
  const wiki = createWikiHarness(database);
  await wiki.addDepartment("alpha");
  const admin = await wiki.addUser("admin", {
    isAdmin: true,
    mode: "admin",
    departments: ["alpha"],
    displayName: "Ada Admin",
  });
  const writer = await wiki.addUser("writer", {
    departments: ["alpha"],
    displayName: "Wanda Writer",
  });
  const provider = createDummyOpenRouter();
  let browserUser: User | null = null;
  const network = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("/chat-api")) return provider.answer(url, init ?? {});
      const response = await sendChatIntent(
        browserUser,
        readBody(init ?? {}) ?? {},
      );
      return new Response(response.text, {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  // Provider adapters keep the transport they were built with.
  vi.stubGlobal("fetch", network);
  const authorization = new AuthorizationRepository(database);
  const administrationService = new AdministrationService(
    authorization,
    new ServerCache(),
    new PasswordHasher(),
  );
  const users = new UserRepository(database);
  const accounts = {
    users: { getById: (id: string) => users.findById(id) },
    administration: administrationService,
  };
  const agents = createAgentServices(database, directory, TOKEN_KEY);
  const chatRequests = new AssistantRequestRegistry({
    timeoutMs: options.chatTimeoutMs ?? 60_000,
    capacity: 4,
  });
  const mcp = createMcpServices(
    database,
    accounts.users,
    administrationService,
    {
      directory,
      wikiService: {
        getSettings: async () => WIKI_SETTING_DEFAULTS,
        openAttachment: (...parameters) =>
          wiki.service.openAttachment(...parameters),
      },
    },
  );
  const chat = createChatServices({
    database,
    directory,
    accounts,
    agents: {
      agentProfileService: agents.agentProfileService,
      agentChatExecution: agents.agentChatExecution,
      chatRequests,
    },
    router: mcp.chatOperationRouter,
  });
  const services: PicaServices = {
    ...agents,
    chatRequests,
    ...chat,
    administrationService,
    agentPlanService: { taskAssignments: async () => ({}) },
  };
  return {
    services,
    database,
    provider,
    network,
    admin,
    writer,
    directories: [directory, wiki.filesDirectory],
    /** Signs a person in for the browser's chat requests. */
    signIn(user: User | null): void {
      browserUser = user;
    },
    /** Adds the OpenRouter access and verifies it, which loads its catalog. */
    async connectOpenRouter(): Promise<string> {
      const created = await submitAgentsForm(admin, {
        intent: "create-connection",
        name: "OpenRouter",
        provider: "openrouter",
        apiKey: PICA_SYNTHETIC_KEY,
        testModel: "",
        reasoningEffort: "",
      });
      const connectionId = readString(created.body.connectionId);
      const check = await submitAgentsForm(admin, {
        intent: "run-check",
        connectionId,
        kind: "auth",
      });
      if (check.status !== 200) throw new Error("The access check failed.");
      return connectionId;
    },
    /** Saves Pica's selection; an empty ID creates a new agent like the editor does. */
    savePica(selection: PicaSelection, profileId = ""): Promise<RouteResult> {
      return submitAgentsForm(admin, {
        intent: "save-profile",
        profileId,
        profile: JSON.stringify(picaProfile(selection)),
      });
    },
    /** Opens the person's chat and sends one message through the chat route. */
    async ask(user: User, text: string): Promise<RouteResult> {
      const opened = await sendChatIntent(user, { intent: "open" });
      const overview = opened.body.overview;
      if (typeof overview !== "object" || overview === null)
        throw new Error("The chat did not open.");
      const session: unknown = Object.fromEntries(
        Object.entries(overview),
      ).session;
      if (typeof session !== "object" || session === null)
        throw new Error("The chat has no session.");
      const sessionId = readString(
        Object.fromEntries(Object.entries(session)).id,
      );
      return sendChatIntent(user, {
        intent: "send",
        message: {
          requestId: `request-${provider.calls.length}-${Date.now()}`,
          sessionId,
          text,
          attachmentIds: [],
        },
      });
    },
  };
}

/** The type of {@link createPicaApplication}. */
export type PicaApplication = Awaited<ReturnType<typeof createPicaApplication>>;

/** Migrated in-memory Pica application; its directories are removed after each test. */
export function usePicaApplication(): (options?: {
  readonly chatTimeoutMs?: number;
}) => Promise<PicaApplication> {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  return async (options) => {
    const application = await createPicaApplication(getDatabase(), options);
    directories.push(...application.directories);
    return application;
  };
}
