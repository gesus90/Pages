import { vi } from "vitest";

import { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { createPicaTools } from "@/backend/service/chat/PicaTools";
import { PICA_TOOL_OUTCOME } from "@/backend/service/chat/PicaToolSchemas";

import { FIRST, OWNER } from "../page48-chat-fixture";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type { RuntimeToolRegistry } from "@/backend/agents/runtime/RuntimeToolRegistry";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import type { PicaToolOutcome } from "@/backend/service/chat/PicaToolSchemas";
import type { AccountAccess } from "@/definition/Authorization";

/** The persisted facts about the person, as the accounts services would answer them. */
export interface PersonState {
  isActive: boolean;
  mustChangePassword: boolean;
  isAdmin: boolean;
  mode: AccountAccess["mode"];
}

type RouterHandle = AgentOperationRouter["handle"];

function account(state: PersonState): AccountAccess {
  return {
    userId: OWNER.id,
    role: null,
    isAdmin: state.isAdmin,
    mode: state.mode,
    firstName: "Owner",
    lastName: "Test",
    isActive: state.isActive,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
  };
}

/** Pages with the real tool catalog, registry, executor and admin service; only the router and the accounts are doubles. */
export interface OperatorWorld {
  readonly person: PersonState;
  readonly service: PicaAdminService;
  readonly tools: ChatToolExecutor;
  readonly router: ReturnType<typeof vi.fn<RouterHandle>>;
  readonly signal: AbortController;
  /** Builds the tools of one turn; `message` is the raw human message that opened the turn. */
  readonly turn: (
    id: string,
    message: string,
  ) => {
    readonly registry: RuntimeToolRegistry;
    readonly context: RuntimeExecutionContext;
  };
  readonly call: (
    turn: ReturnType<OperatorWorld["turn"]>,
    tool: string,
    input: unknown,
  ) => Promise<PicaToolOutcome>;
}

/** Creates an administrator whose rights a test can withdraw at any time. */
export function operatorWorld(
  overrides: Partial<PersonState> = {},
): OperatorWorld {
  const person: PersonState = {
    isActive: true,
    mustChangePassword: false,
    isAdmin: true,
    mode: "admin",
    ...overrides,
  };
  const service = new PicaAdminService({
    users: {
      getById: vi.fn(async () => ({
        ...OWNER,
        isActive: person.isActive,
        mustChangePassword: person.mustChangePassword,
      })),
    },
    administration: { getContext: vi.fn(async () => account(person)) },
  });
  const router = vi.fn<RouterHandle>(async (_, request) => ({
    apiVersion: "1",
    result: { id: "synthetic", name: String(request.operation) },
  }));
  const tools = new ChatToolExecutor({
    identities: {
      verify: async (userId) => ({
        userId,
        isAdmin: person.isAdmin,
        permissions: [],
      }),
    },
    router: { handle: router },
  });
  const sessions: Pick<ChatSessionService, "confirmationWord"> = {
    confirmationWord: async () => "LÖSCHEN",
  };
  const signal = new AbortController();
  const turn: OperatorWorld["turn"] = (id, message) => {
    const context: RuntimeExecutionContext = Object.freeze({
      userId: OWNER.id,
      sessionId: FIRST,
      runId: "job",
      signal: signal.signal,
      authorize: async () => undefined,
    });
    return {
      registry: createPicaTools({
        tools,
        sessions,
        authorize: async () => undefined,
        adminTools: service,
        message,
        planTurnId: id,
      }),
      context: service.bind(context),
    };
  };
  const call: OperatorWorld["call"] = async (current, tool, input) => {
    const invoked = await current.registry.invoke(tool, input, current.context);
    if (invoked === null || !invoked.isValid)
      throw new Error("The call was not valid");
    return PICA_TOOL_OUTCOME.parse(invoked.output);
  };
  return { person, service, tools, router, signal, turn, call };
}
