import { randomUUID } from "node:crypto";

import { AgentMediaError } from "@/backend/error/AgentMediaError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_MEDIA_LIMITS,
  agentMediaMimeTypes,
  isMediaOutputModel,
} from "@/definition/AgentMediaGeneration";

import {
  AgentProviderKeys,
  generationRoute,
  isOwnOpenCodeKey,
  isReleasedGenerationModel,
} from "./AgentProviderKeys";

import type {
  ProviderMedia,
  ProviderMediaClient,
} from "@/backend/agents/providers/ProviderMediaClients";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type {
  AgentMediaKind,
  AgentVideoAspectRatio,
} from "@/definition/AgentMediaGeneration";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";
import type { GenerationProvider } from "./AgentProviderKeys";

/** What the generation of videos and sounds uses. */
export interface AgentMediaGenerationDependencies {
  readonly connections: Pick<
    AgentConnectionRepository,
    "findSecretEncrypted" | "catalogs" | "list" | "checks"
  >;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  /** The models the agent's account may use, for the hint at other models. */
  readonly models: Pick<AgentEmployeeModels, "models">;
  /** Records the cost with the agent, as other model costs. */
  readonly store: Pick<EmployeeStore, "activity">;
  readonly clients: Readonly<Record<GenerationProvider, ProviderMediaClient>>;
}

/** Why a model cannot generate the kind. */
export type AgentMediaRefusal =
  "no_media_output" | "no_media_interface" | "no_key";

/** Whether the model of a round can output the kind, and else which models could. */
export type AgentMediaCapability =
  | { readonly canGenerate: true; readonly modelName: string }
  | {
      readonly canGenerate: false;
      readonly modelName: string;
      readonly reason: AgentMediaRefusal;
      /** The models released for the agent that can output the kind, by name. */
      readonly alternatives: readonly string[];
    };

/** What a capability check knows of the round. */
export interface AgentMediaRound {
  readonly employee: Pick<StoredAgentEmployee, "userId" | "access">;
  /** The model of the round: the agent's own or the one chosen for the chat. */
  readonly assignment: Pick<ResolvedAgentAssignment, "connection" | "model">;
  readonly kind: AgentMediaKind;
}

/** One request of an agent for a video or a sound. */
export interface AgentMediaRequest extends AgentMediaRound {
  readonly prompt: string;
  readonly aspectRatio?: AgentVideoAspectRatio;
  readonly durationSeconds?: number;
  readonly voice?: string;
  readonly signal: AbortSignal;
}

/** The file of one request, with what the model wrote beside it. */
export interface AgentGeneratedMedia {
  readonly media: ProviderMedia;
  readonly text: string;
  readonly costUsd: number | null;
  readonly modelName: string;
}

function modelLabel(model: PageAgentModel): string {
  return `${model.modelName ?? model.name} (${model.connectionName ?? model.provider})`;
}

function isKindCapable(model: PageAgentModel, kind: AgentMediaKind): boolean {
  return kind === "video"
    ? model.isVideoOutputCapable === true
    : model.isAudioOutputCapable === true;
}

/**
 * Generates videos and sounds with the model an agent works with in a chat
 * (PAGE-384).
 *
 * @remarks
 * There is no video or audio model and no setting for one. Whether the model
 * can output the kind comes from the stored catalog (`outputModalities`),
 * never from its name, and Pages must have the documented interface of the
 * provider for it. Pages calls that interface with the key stored for the
 * connection; the agent never sees a key. A model that cannot gets the names
 * of the models released for the agent that could. The cost the provider
 * reports is recorded with the agent like other model costs.
 */
export class AgentMediaGeneration {
  private readonly dependencies: AgentMediaGenerationDependencies;
  private readonly keys: AgentProviderKeys;

  public constructor(dependencies: AgentMediaGenerationDependencies) {
    this.dependencies = dependencies;
    this.keys = new AgentProviderKeys(dependencies, "AgentMediaGeneration");
  }

  /** Whether the model of the round can output the kind, and which models could. */
  public async capability(
    round: AgentMediaRound,
  ): Promise<AgentMediaCapability> {
    const { connection, model } = round.assignment;
    const catalog = await this.dependencies.connections
      .catalogs()
      .find(connection.id);
    const listed = catalog.models.find((entry) => entry.id === model);
    const modelName = listed?.name ?? model;
    const reason = await this.refusal(round, listed);
    if (reason === null) return { canGenerate: true, modelName };
    return {
      canGenerate: false,
      modelName,
      reason,
      alternatives: await this.alternatives(round),
    };
  }

  /**
   * Generates the video or the sound of one request.
   *
   * @throws {AgentMediaError} When the model cannot, the key is missing, the
   * provider refused, or no file came back.
   */
  public async generate(
    request: AgentMediaRequest,
  ): Promise<AgentGeneratedMedia> {
    const capability = await this.capability(request);
    if (!capability.canGenerate)
      throw new AgentMediaError(
        capability.reason,
        capability.alternatives.join(", "),
      );
    const { connection, model } = request.assignment;
    const route = generationRoute(connection, model);
    const apiKey = route ? await this.keys.readKey(connection, route) : null;
    if (!route || apiKey === null) throw new AgentMediaError("no_key");
    const timeoutSeconds =
      request.kind === "video"
        ? AGENT_MEDIA_LIMITS.videoTimeoutSeconds
        : AGENT_MEDIA_LIMITS.audioTimeoutSeconds;
    const answer = await this.dependencies.clients[route.provider].generate({
      apiKey,
      model: route.model,
      kind: request.kind,
      prompt: request.prompt,
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(timeoutSeconds * 1000),
      ]),
      ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
      ...(request.durationSeconds
        ? { durationSeconds: request.durationSeconds }
        : {}),
      ...(request.voice ? { voice: request.voice } : {}),
    });
    const types = agentMediaMimeTypes(request.kind);
    const media = answer.media.find((entry) =>
      Object.hasOwn(types, entry.mimeType),
    );
    await this.recordCost(request.employee.userId, {
      kind: request.kind,
      count: media ? 1 : 0,
      model: capability.modelName,
      costUsd: answer.costUsd,
    });
    if (!media) throw new AgentMediaError("no_media", answer.text);
    return {
      media,
      text: answer.text,
      costUsd: answer.costUsd,
      modelName: capability.modelName,
    };
  }

  private async refusal(
    round: AgentMediaRound,
    listed: { readonly outputModalities?: readonly string[] } | undefined,
  ): Promise<AgentMediaRefusal | null> {
    const { connection, model } = round.assignment;
    if (!listed || !isMediaOutputModel(listed, round.kind))
      return "no_media_output";
    const route = generationRoute(connection, model);
    if (!route)
      return isOwnOpenCodeKey(connection, model)
        ? "no_key"
        : "no_media_interface";
    if (!this.dependencies.clients[route.provider].kinds.includes(round.kind))
      return "no_media_interface";
    return (await this.keys.hasKey(connection, route)) ? null : "no_key";
  }

  /** The models released for the agent that output the kind over an interface Pages has. */
  private async alternatives(round: AgentMediaRound): Promise<string[]> {
    const { employee, assignment, kind } = round;
    try {
      const models = await this.dependencies.models.models(employee.userId);
      return models
        .filter((model) => {
          if (!isKindCapable(model, kind) || !isReleasedGenerationModel(model))
            return false;
          if (
            model.connectionId === assignment.connection.id &&
            model.model === assignment.model
          )
            return false;
          const route = generationRoute(
            { provider: model.provider, cliAccountLabel: null },
            model.model,
          );
          return (
            route !== null &&
            this.dependencies.clients[route.provider].kinds.includes(kind)
          );
        })
        .map(modelLabel);
    } catch (error: unknown) {
      // The hint is a courtesy: without it the agent still says that it cannot.
      logCaughtError("AgentMediaGeneration", error);
      return [];
    }
  }

  private async recordCost(
    agentId: string,
    generation: {
      readonly kind: AgentMediaKind;
      readonly count: number;
      readonly model: string;
      readonly costUsd: number | null;
    },
  ): Promise<void> {
    try {
      await this.dependencies.store.activity().record(agentId, {
        id: randomUUID(),
        kind: generation.kind,
        detail: JSON.stringify({
          count: generation.count,
          model: generation.model,
        }),
        cost:
          generation.costUsd === null
            ? { state: "unknown", amount: null, isEstimated: false }
            : {
                state: "known",
                amount: generation.costUsd,
                isEstimated: false,
              },
      });
    } catch (error: unknown) {
      // A cost that cannot be recorded must not take the file away.
      logCaughtError("AgentMediaGeneration", error);
    }
  }
}
