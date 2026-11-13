import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { withLogContext } from "@/backend/logging/Logger";

import type { RunnerAssetCursors } from "./RunnerAssetCursors";
import type { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import type { RemotePlanStep } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type {
  AgentPlanRemoteParameters,
  RemoteParameterAsset,
  RemotePlanParameters,
} from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { RunnerPagesRequest } from "@/definition/RunnerPagesAccess";

/** The bytes of one file chunk a runner receives. */
export const FILE_CHUNK_BYTES = 512 * 1024;

/** The manifest of a step is one runner message and stays within 1 MiB. */
const MANIFEST_BYTES = 1024 * 1024;

/** What serving the files of a step needs from its live access. */
export interface ParameterFileAccess {
  readonly run: AgentPlanRun;
  readonly remote: RemotePlanStep;
  readonly cursors: RunnerAssetCursors;
}

type AssetRequest = Extract<RunnerPagesRequest["request"], { kind: "asset" }>;

interface ChunkInput {
  readonly asset: RemoteParameterAsset;
  readonly prepared: RemotePlanParameters;
  readonly request: AssetRequest;
}

interface Chunk {
  readonly chunk: Buffer;
  readonly size: number;
}

/**
 * Serves the parameter files of a remote step to its runner: the manifest, then the files in chunks.
 *
 * @remarks
 * A file within the model content budget is read again, whole, for every chunk.
 * A file beyond it is read once, front to back, and compared with the pinned
 * digest at its end, so up to 512 MiB reach the runner without being held in
 * memory. Owner and rights are checked with every chunk either way.
 */
export class RunnerParameterFiles {
  private readonly parameters: AgentPlanRemoteParameters;
  private readonly evidence: AgentPlanRemoteAccessRepository;

  public constructor(dependencies: {
    readonly parameters: AgentPlanRemoteParameters;
    readonly evidence: AgentPlanRemoteAccessRepository;
  }) {
    this.parameters = dependencies.parameters;
    this.evidence = dependencies.evidence;
  }

  /** Lists the pinned files with the text extracts a model may read. */
  public async manifest(access: ParameterFileAccess): Promise<unknown> {
    return withLogContext(
      { runId: access.run.id, stepId: access.remote.step.id },
      () => this.manifestFiles(access),
    );
  }

  /** Answers one chunk of one file and records which file the step received. */
  public async chunk(
    access: ParameterFileAccess,
    request: AssetRequest,
  ): Promise<unknown> {
    return withLogContext(
      { runId: access.run.id, stepId: access.remote.step.id },
      () => this.serveChunk(access, request),
    );
  }

  private async manifestFiles(access: ParameterFileAccess): Promise<unknown> {
    const prepared = access.remote.parameters;
    if (!prepared) throw new AgentError("plan_mcp_unavailable");
    const files = [];
    for (const asset of prepared.assets) {
      // A streamed file has no model content to extract and is not read here.
      const current = this.parameters.isStreamed(asset)
        ? null
        : await this.parameters.readAssetContent(
            access.run.userId,
            asset,
            prepared,
          );
      files.push({
        ...asset.file,
        textExtract:
          current?.content.type === "text" &&
          current.content.representation === "text-extract"
            ? current.content.text
            : undefined,
      });
      if (Buffer.byteLength(JSON.stringify(files)) > MANIFEST_BYTES)
        throw new AgentAssetError(
          "parameter_assets_too_large",
          asset.reference,
          asset.file.name,
        );
    }
    return { files };
  }

  private async serveChunk(
    access: ParameterFileAccess,
    request: AssetRequest,
  ): Promise<unknown> {
    const prepared = access.remote.parameters;
    const asset = prepared?.assets[request.index];
    if (!prepared || !asset)
      throw new AgentError("parameter_asset_unavailable");
    const isStreamed = this.parameters.isStreamed(asset);
    const input = { asset, prepared, request };
    const { chunk, size } = isStreamed
      ? await this.streamedChunk(access, input)
      : await this.bufferedChunk(access, input);
    const attemptId = access.run.steps.find(
      (entry) => entry.id === access.remote.step.id,
    )?.execution?.attemptId;
    if (!attemptId) throw new AgentError("plan_context_changed");
    // The evidence of a file does not change between its chunks.
    if (!isStreamed || request.offset === 0)
      await this.evidence.write(access.run.id, attemptId, (previous) => ({
        pages: "active",
        events: previous?.events ?? [],
        files: [
          ...(previous?.files ?? []).filter(
            (file) =>
              file.asset?.link !== asset.reference.link ||
              file.parameter !== asset.file.parameter,
          ),
          asset.file,
        ],
      }));
    return {
      base64: chunk.toString("base64"),
      size,
      done: request.offset + chunk.length === size,
    };
  }

  private async bufferedChunk(
    access: ParameterFileAccess,
    input: ChunkInput,
  ): Promise<Chunk> {
    const { asset, prepared, request } = input;
    const bytes = await this.parameters.readAsset(
      access.run.userId,
      asset,
      prepared,
    );
    if (request.offset > bytes.length)
      throw new AgentError("parameter_asset_unavailable");
    return {
      chunk: bytes.subarray(request.offset, request.offset + FILE_CHUNK_BYTES),
      size: bytes.length,
    };
  }

  private async streamedChunk(
    access: ParameterFileAccess,
    input: ChunkInput,
  ): Promise<Chunk> {
    const { asset, prepared, request } = input;
    try {
      await this.parameters.authorizeAsset(access.run.userId, asset, prepared);
      return {
        chunk: await access.cursors.read(
          request.index,
          request.offset,
          FILE_CHUNK_BYTES,
          {
            size: asset.file.size,
            digest: asset.file.digest,
            open: () =>
              this.parameters.openAsset(access.run.userId, asset, prepared),
          },
        ),
        size: asset.file.size,
      };
    } catch (error: unknown) {
      if (error instanceof AgentError && !(error instanceof AgentAssetError))
        throw new AgentAssetError(error.code, asset.reference, asset.file.name);
      throw error;
    }
  }
}
