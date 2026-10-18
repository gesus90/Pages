import { vi } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { ChatAgentOperationService } from "@/backend/service/agents/ChatAgentOperationService";
import { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import { ChatService } from "@/backend/service/chat/ChatService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { PageAgentWorld } from "../agents/page-agent-world";

import type { TextExecutionInput } from "@/backend/agents/TextExecution";
import type { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import type { StoredChatMessage } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { ChatActionOutcome } from "@/backend/service/chat/ChatPrompt";
import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentProfile } from "@/definition/AgentProfile";
import type { ChatConfirmationWord, ChatReply } from "@/definition/Chat";
import type { Language } from "@/language/Language";
import type { User } from "@/definition/User";

export const PERSON: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor Test",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

export const PARAMETERS: readonly AgentParameter[] = [
  {
    name: "topic",
    type: "text",
    description: "Topic",
    isRequired: true,
    defaultValue: { type: "text", text: "Synthetic" },
  },
  {
    name: "amount",
    type: "number",
    description: "Amount",
    isRequired: false,
    defaultValue: { type: "number", number: 0 },
  },
  {
    name: "ticket",
    type: "ticket",
    description: "Ticket",
    isRequired: false,
    defaultValue: { type: "ticket", ticketId: "ticket-1" },
  },
];

const SESSION = {
  id: "apfel-birne-kirsche-pflaume-traube",
  createdAt: "2026-10-14",
  lastMessageAt: "2026-10-14",
  preview: "",
};

/** A production action block from a scripted model; no provider is called. */
export function modelAction(
  operation: string,
  parameters: Readonly<Record<string, unknown>> = {},
): string {
  return `\`\`\`pages-action\n${JSON.stringify({ operation, parameters })}\n\`\`\``;
}

/** Synthetic accounts and repositories, with the production chat executor and agent services. */
export class ChatAgentWorld {
  public readonly tickets = vi.fn(async (userId: string, ticketId: string) => {
    if (ticketId !== "ticket-1" || userId === "outsider")
      throw new Error("Unexpected ticket access");
    return {
      id: ticketId,
      key: "SYN-1",
      title: "Ticket",
      description: "Synthetic ticket",
      assets: [],
      markdown: "Synthetic ticket",
      version: "1",
    };
  });
  public readonly world = new PageAgentWorld({
    choices: async () => [],
    resolve: this.tickets,
  });
  public readonly operations: ChatAgentOperationService;
  public readonly tools: ChatToolExecutor;
  public readonly verify = vi.fn(async (userId: string) => {
    const account = this.world
      .snapshot()
      .accounts.find((entry) => entry.userId === userId);
    if (!account?.isActive)
      throw new McpAuthorizationError("invalid_token", 401);
    return this.world.identity(userId);
  });
  public readonly prompts: TextExecutionInput[] = [];
  public readonly messages: StoredChatMessage[] = [];
  private replies: string[] = [];

  /**
   * @param plans - Plan operations the chat may call as well; none when absent.
   */
  public constructor(plans?: Pick<AgentPlanOperationService, "handle">) {
    this.world.addPerson("igor");
    this.world.addPerson("member");
    this.world.addPerson("outsider");
    this.world.addPerson("admin", { isAdmin: true });
    this.world.addGroup("builders", ["member"]);
    this.world.addDepartment("sales");
    this.world.addModel("model", {
      targets: [
        { kind: "person", targetId: "igor" },
        { kind: "person", targetId: "member" },
      ],
    });
    this.operations = new ChatAgentOperationService({
      database: { transaction: (work) => this.world.transaction(work) },
      agents: this.world.agents,
    });
    this.tools = new ChatToolExecutor({
      identities: { verify: this.verify },
      router: {
        handle: async (identity, request) => {
          const response =
            (await plans?.handle(
              identity,
              request.operation,
              request.parameters,
            )) ??
            (await this.operations.handle(
              identity,
              request.operation,
              request.parameters,
            ));
          if (response === null)
            throw new AgentOperationError("INVALID_REQUEST");
          return response;
        },
      },
    });
  }

  /** Supplies a configured existing agent through the same save as the interface. */
  public async seed(): Promise<string> {
    return this.world.agents.save("igor", null, {
      name: "Synthetic reviewer",
      modelProfileId: "model",
      reasoningEffort: null,
      configuration: {
        ...emptyAgentConfiguration(),
        tag: "review",
        accessMode: "shared",
        markdown: "Review {{topic}} and {{amount}} for {{ticket}}.",
        parameters: PARAMETERS,
        sharing: {
          isGlobal: false,
          targets: [{ kind: "group", targetId: "builders" }],
        },
        run: {
          access: "read_only",
          shell: false,
          web: true,
          timeoutMinutes: 17,
        },
      },
    });
  }

  /** Returns one stored synthetic profile for before/after comparisons. */
  public stored(id: string): AgentProfile {
    const profile = this.world.stored().find((entry) => entry.id === id);
    if (!profile) throw new Error("Missing synthetic profile");
    return profile;
  }

  /** Runs an action in the requested person's current context. */
  public run(
    operation: string,
    parameters: Readonly<Record<string, unknown>> = {},
    options: {
      readonly userId?: string;
      readonly confirmation?: ChatConfirmationWord;
    } = {},
  ): Promise<ChatActionOutcome> {
    return this.tools.run(
      options.userId ?? "igor",
      { operation, parameters },
      options.confirmation ?? null,
    );
  }

  /** Feeds scripted replies through a real chat turn with mocked message storage and model execution. */
  public async send(
    text: string,
    replies: readonly string[],
    language: Language = "de",
  ): Promise<ChatReply> {
    this.replies = [...replies];
    const chat = new ChatService({
      mode: "legacy-actions",
      sessions: { require: async () => SESSION },
      messages: {
        messages: async () => [...this.messages],
        findByClientId: async () => null,
        append: async (userId, sessionId, input) => {
          if (userId !== "igor" || sessionId !== SESSION.id)
            throw new Error("Unexpected chat storage actor");
          const message = {
            ...input,
            id: `message-${this.messages.length}`,
            createdAt: "2026-10-14",
          };
          this.messages.push(message);
          return message;
        },
      },
      attachments: {
        pending: async () => [],
        link: async () => undefined,
        readText: async () => "",
      },
      settings: { instruction: async () => "Synthetic Pica" },
      protectedInstructions: async () => ({
        soul: "Synthetic soul",
        agents: "Synthetic rules",
      }),
      agents: {
        resolve: async () => ({
          connection: this.world.facts("connection-model").connection,
          model: "model-model",
          reasoningEffort: null,
        }),
      },
      execution: {
        run: async (input) => {
          this.prompts.push(input);
          const reply = this.replies.shift();
          if (reply === undefined)
            throw new Error("Missing scripted model reply");
          return reply;
        },
      },
      tools: this.tools,
      requests: new ChatRequestRegistry({
        timeoutMs: 10_000,
        capacity: 1,
      }),
      languages: {
        findByUserId: async () => ({
          language,
          theme: null,
          timezone: null,
          dateFormat: null,
          weekStart: null,
          notifyEmail: null,
          notifyDesktop: null,
          notifyMentions: null,
          notifyAssignments: null,
          notifyDueDates: null,
          notifyWeeklySummary: null,
        }),
      },
      today: () => "2026-10-14",
    });
    return chat.send(PERSON, {
      requestId: `request-${this.messages.length}`,
      sessionId: SESSION.id,
      text,
    });
  }
}
