import { TextAssistantError } from "@/backend/error/TextAssistantErrors";

import { createTextAssistantPrompt } from "./TextAssistantPrompt";
import {
  readAssistantContext,
  readAssistantIdentifier,
  readAssistantPreferences,
  readAssistantRequest,
  redactAssistantCredentials,
} from "./TextAssistantValidation";

import type { AssistantConversationRepository } from "@/backend/database/repositories/assistant/AssistantConversationRepository";
import type { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { User } from "@/definition/User";
import type {
  TextAssistantContext,
  TextAssistantResult,
  TextAssistantPreferences,
  AssistantConversation,
  AssistantMessage,
  TextAssistantRequest,
} from "@/definition/TextAssistant";
import type { TextAgentRoleService } from "./TextAgentRoleService";
import type { TextAssistantContextService } from "./TextAssistantContextService";
import type { AssistantRequestRegistry } from "./AssistantRequestRegistry";

interface AssistantDependencies {
  readonly roles: TextAgentRoleService;
  readonly contexts: TextAssistantContextService;
  readonly conversations: AssistantConversationRepository;
  readonly settings: TextAssistantSettingsRepository;
  readonly requests: AssistantRequestRegistry;
  readonly execution: TextExecution;
}

function requireActor(actor: User): void {
  if (!actor.isActive || actor.mustChangePassword)
    throw new TextAssistantError("accessDenied");
}

/** Produces text suggestions and private histories without writing document fields. */
export class TextAssistantService {
  private readonly dependencies: AssistantDependencies;

  public constructor(dependencies: AssistantDependencies) {
    this.dependencies = dependencies;
  }

  /** Explicit generation pins request ownership before any asynchronous work. */
  public run(actor: User, input: unknown): Promise<TextAssistantResult> {
    requireActor(actor);
    const request = readAssistantRequest(input);
    return this.dependencies.requests.run(
      actor.id,
      request.requestId,
      (signal) => this.execute(actor, request, signal),
    );
  }

  /** Rechecks current visibility, write permission and the saved version before local apply. */
  public async validate(actor: User, input: unknown): Promise<void> {
    requireActor(actor);
    const request = readAssistantRequest(input);
    await this.dependencies.contexts.validate(
      actor,
      request.context,
      request.change,
    );
  }

  /** Loads only this person's conversations after checking current context visibility. */
  public async history(
    actor: User,
    input: unknown,
  ): Promise<{
    readonly conversations: readonly AssistantConversation[];
    readonly preferences: TextAssistantPreferences;
  }> {
    requireActor(actor);
    const context = readAssistantContext(input);
    await this.dependencies.contexts.read(actor, context);
    await this.dependencies.conversations.sweep();
    return {
      conversations: await this.dependencies.conversations.list(
        actor.id,
        context,
      ),
      preferences: await this.dependencies.settings.preferences(actor.id),
    };
  }

  /** A conversation ID alone never authorizes reading another person's messages. */
  public async messages(
    actor: User,
    context: TextAssistantContext,
    id: string,
  ): Promise<readonly AssistantMessage[]> {
    await this.history(actor, context);
    const conversationId = readAssistantIdentifier(id);
    await this.dependencies.conversations.require(
      actor.id,
      context,
      conversationId,
    );
    return this.dependencies.conversations.messages(conversationId);
  }

  /** Own-history deletion remains possible after the context is no longer visible. */
  public async remove(actor: User, id: string): Promise<void> {
    requireActor(actor);
    await this.dependencies.conversations.remove(
      actor.id,
      readAssistantIdentifier(id),
    );
  }

  /** Stores personal preferences without granting any instance configuration rights. */
  public async savePreferences(actor: User, input: unknown): Promise<void> {
    requireActor(actor);
    await this.dependencies.settings.savePreferences(
      actor.id,
      readAssistantPreferences(input),
    );
  }

  /** Cancellation is owned and independent of the currently open document. */
  public cancel(actor: User, id: string): void {
    requireActor(actor);
    this.dependencies.requests.cancel(actor.id, readAssistantIdentifier(id));
  }

  /** Drains generation before the shared database is closed. */
  public shutdown(): Promise<void> {
    return this.dependencies.requests.shutdown();
  }

  private async execute(
    actor: User,
    request: TextAssistantRequest,
    signal: AbortSignal,
  ): Promise<TextAssistantResult> {
    const { roles, contexts, conversations, execution } = this.dependencies;
    await contexts.validate(actor, request.context, request.change);
    const agent = await roles.resolve();
    await conversations.sweep();
    let conversationId = request.conversationId;
    if (conversationId !== null)
      await conversations.require(actor.id, request.context, conversationId);
    else conversationId = await conversations.create(actor.id, request.context);
    signal.throwIfAborted();
    const output = await execution.run(
      { agent, prompt: createTextAssistantPrompt(request) },
      signal,
    );
    signal.throwIfAborted();
    if (!output.trim() || output.length > 200_000)
      throw new TextAssistantError("invalidOutput");
    await contexts.validate(actor, request.context, request.change);
    signal.throwIfAborted();
    const text = redactAssistantCredentials(output);
    await conversations.append(conversationId, {
      instruction:
        request.instruction || `${request.action}: ${request.targetLanguage}`,
      text,
      change: request.change,
      signal,
    });
    return {
      requestId: request.requestId,
      conversationId,
      text,
      change: request.change,
      context: request.context,
    };
  }
}
