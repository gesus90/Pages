import { randomUUID } from "node:crypto";

import { AgentImageError } from "@/backend/error/AgentImageError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_IMAGE_LIMITS,
  AGENT_IMAGE_MIME_TYPES,
  isImageOutputModel,
} from "@/definition/AgentImageGeneration";

import { isChatModelChoice } from "./AgentChatModelChoices";
import {
  AgentProviderKeys,
  generationRoute,
  isOwnOpenCodeKey,
} from "./AgentProviderKeys";

import type {
  ProviderImage,
  ProviderImageClient,
} from "@/backend/agents/providers/ProviderImageClients";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { GenerationProvider } from "./AgentProviderKeys";
import type { AgentImageAspectRatio } from "@/definition/AgentImageGeneration";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type { AgentEmployeeModels } from "./AgentEmployeeModels";

type ImageProvider = GenerationProvider;

/** What the generation of images uses. */
export interface AgentImageGenerationDependencies {
  readonly connections: Pick<
    AgentConnectionRepository,
    "find" | "findSecretEncrypted" | "catalogs" | "list" | "checks"
  >;
  readonly cipher: Pick<InstanceSecretCipher, "decrypt">;
  /** The models the agent's account may use, for the hint at other models. */
  readonly models: Pick<AgentEmployeeModels, "models">;
  /** Records the cost with the agent, as other model costs (PAGE-382). */
  readonly store: Pick<EmployeeStore, "activity">;
  readonly clients: Readonly<Record<ImageProvider, ProviderImageClient>>;
}

/** Whether the model of a round can output images, and else which could. */
export type AgentImageCapability =
  | { readonly canGenerate: true; readonly modelName: string }
  | {
      readonly canGenerate: false;
      readonly modelName: string;
      readonly reason: "no_image_output" | "no_image_interface" | "no_key";
      /** The models released for the agent that can output images, by name. */
      readonly alternatives: readonly string[];
    };

/** One request of an agent for images. */
export interface AgentImageRequest {
  readonly employee: Pick<StoredAgentEmployee, "userId" | "access">;
  /** The model of the round: the agent's own or the one chosen for the chat. */
  readonly assignment: Pick<ResolvedAgentAssignment, "connection" | "model">;
  readonly prompt: string;
  readonly count: number;
  readonly aspectRatio?: AgentImageAspectRatio;
  readonly templates: readonly ProviderImage[];
  readonly signal: AbortSignal;
}

/** The images of one request, with what the model wrote beside them. */
export interface AgentGeneratedImages {
  readonly images: readonly ProviderImage[];
  readonly text: string;
  readonly costUsd: number | null;
  readonly modelName: string;
}

/** The route to the image function of a model (PAGE-382); see {@link generationRoute}. */
const imageRoute = generationRoute;

function modelLabel(model: PageAgentModel): string {
  return `${model.modelName ?? model.name} (${model.connectionName ?? model.provider})`;
}

/**
 * Generates images with the model an agent works with in a chat (PAGE-382).
 *
 * @remarks
 * There is no image model and no setting for one. Whether the model can
 * output images comes from the stored catalog (`outputModalities`), never
 * from its name. Pages calls the documented image interface of the provider
 * with the key stored for the connection; the agent never sees a key. A
 * model without image output gets the names of the models released for the
 * agent that have it. The cost the provider reports is recorded with the
 * agent like other model costs.
 */
export class AgentImageGeneration {
  private readonly dependencies: AgentImageGenerationDependencies;
  private readonly keys: AgentProviderKeys;

  public constructor(dependencies: AgentImageGenerationDependencies) {
    this.dependencies = dependencies;
    this.keys = new AgentProviderKeys(dependencies, "AgentImageGeneration");
  }

  /** Whether the model of the round can output images, and which models could. */
  public async capability(
    request: Pick<AgentImageRequest, "employee" | "assignment">,
  ): Promise<AgentImageCapability> {
    const { connection, model } = request.assignment;
    const catalog = await this.dependencies.connections
      .catalogs()
      .find(connection.id);
    const listed = catalog.models.find((entry) => entry.id === model);
    const modelName = listed?.name ?? model;
    const reason = await this.refusal(connection, model, listed);
    if (reason === null) return { canGenerate: true, modelName };
    return {
      canGenerate: false,
      modelName,
      reason,
      alternatives: await this.alternatives(
        request.employee,
        request.assignment,
      ),
    };
  }

  /**
   * Generates the images of one request, one call per image.
   *
   * @throws {AgentImageError} When the model cannot, the key is missing, the
   * provider refused, or no image came back.
   */
  public async generate(
    request: AgentImageRequest,
  ): Promise<AgentGeneratedImages> {
    const capability = await this.capability(request);
    if (!capability.canGenerate)
      throw new AgentImageError(
        capability.reason,
        capability.alternatives.join(", "),
      );
    const { connection, model } = request.assignment;
    const route = imageRoute(connection, model);
    const apiKey = route ? await this.keys.readKey(connection, route) : null;
    if (!route || apiKey === null) throw new AgentImageError("no_key");
    const signal = AbortSignal.any([
      request.signal,
      AbortSignal.timeout(AGENT_IMAGE_LIMITS.timeoutSeconds * 1000),
    ]);
    const client = this.dependencies.clients[route.provider];
    const answers = await Promise.all(
      Array.from({ length: request.count }, () =>
        client.generate({
          apiKey,
          model: route.model,
          prompt: request.prompt,
          templates: request.templates,
          signal,
          ...(request.aspectRatio ? { aspectRatio: request.aspectRatio } : {}),
        }),
      ),
    );
    const images = answers
      .flatMap((answer) => answer.images)
      .filter((image) => Object.hasOwn(AGENT_IMAGE_MIME_TYPES, image.mimeType))
      .slice(0, request.count);
    const costs = answers.map((answer) => answer.costUsd);
    const costUsd = costs.every((cost) => cost !== null)
      ? costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0)
      : null;
    const text =
      answers.map((answer) => answer.text).find((entry) => entry !== "") ?? "";
    await this.recordCost(request.employee.userId, {
      count: images.length,
      model: capability.modelName,
      costUsd,
    });
    if (images.length === 0) throw new AgentImageError("no_images", text);
    return { images, text, costUsd, modelName: capability.modelName };
  }

  private async refusal(
    connection: AgentConnectionRecord,
    model: string,
    listed: { readonly outputModalities?: readonly string[] } | undefined,
  ): Promise<"no_image_output" | "no_image_interface" | "no_key" | null> {
    if (!listed || !isImageOutputModel(listed)) return "no_image_output";
    const route = imageRoute(connection, model);
    if (!route)
      return isOwnOpenCodeKey(connection, model)
        ? "no_key"
        : "no_image_interface";
    return (await this.keys.hasKey(connection, route)) ? null : "no_key";
  }

  /** The models released for the agent that output images over a route Pages has. */
  private async alternatives(
    employee: AgentImageRequest["employee"],
    current: AgentImageRequest["assignment"],
  ): Promise<string[]> {
    try {
      const models = await this.dependencies.models.models(employee.userId);
      return models
        .filter(
          (model) =>
            model.isImageOutputCapable === true &&
            isChatModelChoice(model, employee) &&
            !(
              model.connectionId === current.connection.id &&
              model.model === current.model
            ) &&
            imageRoute(
              { provider: model.provider, cliAccountLabel: null },
              model.model,
            ) !== null,
        )
        .map(modelLabel);
    } catch (error: unknown) {
      // The hint is a courtesy: without it the agent still says that it cannot.
      logCaughtError("AgentImageGeneration", error);
      return [];
    }
  }

  private async recordCost(
    agentId: string,
    generation: {
      readonly count: number;
      readonly model: string;
      readonly costUsd: number | null;
    },
  ): Promise<void> {
    try {
      await this.dependencies.store.activity().record(agentId, {
        id: randomUUID(),
        kind: "image",
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
      // A cost that cannot be recorded must not take the images away.
      logCaughtError("AgentImageGeneration", error);
    }
  }
}
