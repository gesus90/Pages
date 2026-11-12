import path from "node:path";

import { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationGroupContextRepository } from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";
import { ConversationObserverRunRepository } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";
import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import { AgentChatSettingsService } from "@/backend/service/conversation/AgentChatSettingsService";
import { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import { ConversationGroupSummaries } from "@/backend/service/conversation/ConversationGroupSummaries";
import { ConversationGroupSummaryScheduler } from "@/backend/service/conversation/ConversationGroupSummaryScheduler";
import { ConversationObserverModel } from "@/backend/service/conversation/ConversationObserverModel";
import { ConversationObserverRouting } from "@/backend/service/conversation/ConversationObserverRouting";
import { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { voiceMaximumDurationMs } from "@/backend/config/SpeechRecognitionConfig";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import type { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import type { Database } from "@/backend/database/Database";
import type { ConversationAgentRunner } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";

/** The stored conversations of the chat page and Pica Mobile (PAGE-278). */
export interface ConversationApplicationServices {
  readonly conversationReader: ConversationReader;
  readonly conversationService: ConversationService;
  /** The answers of agents in conversations (PAGE-276). */
  readonly conversationAgentReplies: ConversationAgentReplies;
  /** The stored context of groups (PAGE-296). */
  readonly conversationContextReader: ConversationContextReader;
  /** Who answers in a group chat (PAGE-317). */
  readonly conversationReplySettingsService: ConversationReplySettingsService;
  /** The longest voice message Pages takes, in milliseconds (PAGE-277). */
  readonly conversationVoiceMaximumMs: number;
  /** The Pages tools with which agents read chats and send messages (PAGE-311). */
  readonly agentChatService: AgentChatService;
  /** The chain and hourly limits of the chat of agents, and the release of a paused one (PAGE-311). */
  readonly conversationAgentGuard: ConversationAgentGuard;
  /** Who reads the conversations that only agents take part in (PAGE-311). */
  readonly conversationOversight: ConversationOversight;
  /** The hourly limit under Settings → Agents (PAGE-311). */
  readonly agentChatSettingsService: AgentChatSettingsService;
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
  /** Runs the answers of agents (PAGE-276). */
  readonly runner: ConversationAgentRunner;
  /** The speech model and the longest recording of `config.toml` (PAGE-277). */
  readonly speech?: SpeechRecognitionSetting;
  /** The group observer on Pica's chat model (PAGE-296). */
  readonly observer: ConversationObserverInput;
}

/** What the group observer runs on (PAGE-296). */
export interface ConversationObserverInput {
  /** Pica's central model choice and its authorized resolver. */
  readonly pica: Pick<PicaSettingsService, "resolve" | "requireCurrent">;
  /** The ACP path its sessions open on; `null` without one. */
  readonly plans: PlanExecution | null;
  /** The simulated observer; set only while the simulation is on. */
  readonly simulation: SimulatedConversationObserver | null;
  /** The decision model of the instance, which chooses agents in group chats (PAGE-317). */
  readonly decision: Pick<ChatDecisionSettingsService, "resolve">;
  /** The simulated decision model; set only while the simulation is on. */
  readonly decisionSimulation: SimulatedConversationDecision | null;
  /**
   * Whether this process runs the background work: the summaries and the
   * end of answers an earlier process left open.
   */
  readonly isBackgroundOwner: boolean;
}

declare global {
  var pagesConversationAgentReplies: (() => void) | undefined;
  var pagesConversationSummaries: ConversationGroupSummaryScheduler | undefined;
}

/**
 * Tells the live view whether an account is a member of a conversation.
 *
 * @param database - The open database.
 * @returns The membership check of the live view.
 */
export function conversationMembership(database: Database): {
  isMember(actor: User, conversationId: string): Promise<boolean>;
} {
  const conversations = new ConversationRepository(database);
  return {
    isMember: async (actor, conversationId) =>
      (await conversations.findForMember(conversationId, actor.id)) !== null,
  };
}

/**
 * Wires the conversations on the shared database: their reads and writes,
 * the audio of voice messages in the file store, the recognition of their
 * text and the answers of agents, which follow the committed messages of the
 * process from now on; a second wiring replaces the first.
 *
 * @param input - Database, data directory, the publisher of the live view
 * and the runner of agent answers.
 * @returns The reader, the writing service and the agent answers.
 */
export function createConversationServices(
  input: ConversationServicesInput,
): ConversationApplicationServices {
  const { database } = input;
  const conversations = new ConversationRepository(database);
  const messages = new ConversationMessageRepository(database);
  const files = new WikiFileStore(
    path.join(input.directory, "conversation-voice"),
  );
  const store = new EmployeeStore(database);
  const directory = new ConversationDirectory({
    users: new UserRepository(database),
    lookups: new WikiLookupRepository(database),
    jobTitles: () => store.identities().jobTitles(),
  });
  const decisions = new ConversationDecisionRepository(database);
  const replySettings = new ConversationReplySettingsRepository(database);
  const conversationReader = new ConversationReader({
    conversations,
    messages,
    directory,
    files,
    decisions,
  });
  const events = sharedConversationEvents();
  const observer = createObserver(input, {
    conversations,
    messages,
    directory,
  });
  const agentChat = new ConversationAgentChatRepository(database);
  const agentChatSettings = new AgentChatSettingsRepository(database);
  const conversationOversight = new ConversationOversight({
    authorization: new AuthorizationRepository(database),
    chat: agentChat,
    reader: conversationReader,
  });
  const conversationAgentGuard = new ConversationAgentGuard({
    chat: agentChat,
    settings: agentChatSettings,
    members: conversationReader,
    oversight: conversationOversight,
    publisher: input.events,
  });
  const conversationAgentReplies = new ConversationAgentReplies({
    conversations,
    messages,
    directory,
    runner: input.runner,
    rounds: observer.rounds,
    contexts: observer.reader,
    routing: observer.routing,
    replySettings,
    decisions: new ConversationChatDecisions({
      messages,
      rounds: observer.rounds,
      decisions,
      model: new ConversationDecisionModel({
        settings: input.observer.decision,
        plans: input.observer.plans,
        simulation: input.observer.decisionSimulation,
      }),
      publisher: input.events,
    }),
    events,
    publisher: input.events,
    guard: conversationAgentGuard,
  });
  globalThis.pagesConversationAgentReplies?.();
  globalThis.pagesConversationAgentReplies = conversationAgentReplies.start();
  if (input.observer.isBackgroundOwner)
    startObserverBackground(conversationAgentReplies, observer.summaries);
  const conversationVoiceMaximumMs = voiceMaximumDurationMs(input.speech);
  const conversationService = new ConversationService({
    conversations,
    messages,
    reader: conversationReader,
    directory,
    voices: new ConversationVoiceStore(files, conversationVoiceMaximumMs),
    files,
    transcriber: createConversationTranscriber({ speech: input.speech }),
    events,
    publisher: input.events,
  });
  return {
    conversationReader,
    conversationAgentReplies,
    conversationContextReader: observer.reader,
    conversationReplySettingsService: new ConversationReplySettingsService({
      conversations,
      settings: replySettings,
      directory,
      publisher: input.events,
    }),
    conversationVoiceMaximumMs,
    conversationService,
    conversationAgentGuard,
    agentChatSettingsService: new AgentChatSettingsService(agentChatSettings),
    conversationOversight,
    agentChatService: new AgentChatService({
      users: new UserRepository(database),
      groups: new UserGroupRepository(database),
      conversations,
      reader: conversationReader,
      service: conversationService,
      directory,
      guard: conversationAgentGuard,
      events,
    }),
  };
}

/** The parts of the group observer (PAGE-296). */
interface ObserverParts {
  readonly rounds: ConversationRoundRepository;
  readonly reader: ConversationContextReader;
  readonly routing: ConversationObserverRouting;
  readonly summaries: ConversationGroupSummaries;
}

function createObserver(
  input: ConversationServicesInput,
  shared: {
    readonly conversations: ConversationRepository;
    readonly messages: ConversationMessageRepository;
    readonly directory: ConversationDirectory;
  },
): ObserverParts {
  const { database } = input;
  const rounds = new ConversationRoundRepository(database);
  const contexts = new ConversationGroupContextRepository(database);
  const reader = new ConversationContextReader({ ...shared, contexts });
  const model = new ConversationObserverModel({
    pica: input.observer.pica,
    plans: input.observer.plans,
    runs: new ConversationObserverRunRepository(database),
    simulation: input.observer.simulation,
  });
  return {
    rounds,
    reader,
    routing: new ConversationObserverRouting({
      messages: shared.messages,
      contexts: reader,
      model,
    }),
    summaries: new ConversationGroupSummaries({
      ...shared,
      contexts,
      rounds,
      model,
    }),
  };
}

/**
 * Ends the answers an earlier process left open and starts the summaries of
 * groups; a second wiring replaces the scheduler of the first.
 */
function startObserverBackground(
  replies: ConversationAgentReplies,
  summaries: ConversationGroupSummaries,
): void {
  // Only what an earlier process left: answers of this process keep running.
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000);
  void replies.recover(processStartedAt).catch((error: unknown) => {
    logCaughtError("ConversationAgentReplies", error);
  });
  const previous = globalThis.pagesConversationSummaries;
  void previous?.shutdown().catch((error: unknown) => {
    logCaughtError("ConversationGroupSummaryScheduler", error);
  });
  const scheduler = new ConversationGroupSummaryScheduler(
    summaries,
    sharedConversationEvents(),
  );
  scheduler.start();
  globalThis.pagesConversationSummaries = scheduler;
}
