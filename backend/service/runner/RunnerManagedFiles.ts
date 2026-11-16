import { Readable } from "node:stream";

import { AgentError } from "@/backend/error/AgentErrors";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { remoteAssetFile } from "@/backend/service/agents/AgentAssetRemoteFile";

import { RunnerAssetCursors } from "./RunnerAssetCursors";
import { FILE_CHUNK_BYTES, RunnerParameterFiles } from "./RunnerParameterFiles";

import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type { AgentParameterService } from "@/backend/service/agents/AgentParameterService";
import type { AgentPlanRemoteParameters } from "@/backend/service/agents/AgentPlanRemoteParameters";
import type { AgentPlanRemoteAccessRepository } from "@/backend/database/repositories/agent/AgentPlanRemoteAccessRepository";
import type { RunnerJob } from "@/definition/RunnerProtocol";
import type { RunnerPagesRequest } from "@/definition/RunnerPagesAccess";
import type { AgentPlanRun } from "@/definition/AgentPlan";

interface ManagedFilesDependencies {
  readonly runs: AgentPlanRunRepository;
  readonly readBody: (reference: string) => Promise<string>;
  readonly parameters: AgentPlanRemoteParameters;
  readonly local: Pick<AgentParameterService, "readTicketAssets">;
  readonly evidence: AgentPlanRemoteAccessRepository;
}

/** Serves the same pinned originals to local and remote plan sessions, including loop members. */
export class RunnerManagedFiles {
  private readonly dependencies: ManagedFilesDependencies;
  private readonly remote: RunnerParameterFiles;
  private readonly cursors = new Map<
    string,
    { readonly access: RunnerAssetCursors; readonly touchedAt: number }
  >();

  public constructor(dependencies: ManagedFilesDependencies) {
    this.dependencies = dependencies;
    this.remote = new RunnerParameterFiles(dependencies);
  }

  /** Rechecks source rights and integrity for every manifest and original-file chunk. */
  public async receive(
    job: RunnerJob,
    request: RunnerPagesRequest["request"],
  ): Promise<unknown> {
    const binding = job.plan;
    if (!binding || (request.kind !== "prepare" && request.kind !== "asset"))
      throw new AgentError("parameter_asset_unavailable");
    const run = await this.dependencies.runs.find(binding.runId);
    if (!run) throw new AgentError("plan_run_unavailable");
    const snapshot = await this.loadSnapshot(job, run.id);
    if (snapshot.plan.id !== run.planId)
      throw new AgentError("plan_context_changed");
    const remote = snapshot.remoteSteps?.find(
      (entry) => entry.step.id === binding.stepId,
    );
    const cursors = this.forJob(job.jobId);
    if (remote?.parameters) {
      await this.dependencies.parameters.authorize(
        run.userId,
        remote.parameters,
        { projectId: snapshot.plan.projectId, target: remote.target },
      );
      const access = {
        run,
        remote,
        cursors,
        attemptId: binding.recordingAttemptId ?? binding.attemptId,
      };
      return request.kind === "prepare"
        ? this.remote.manifest(access)
        : this.remote.chunk(access, request);
    }
    return this.receiveLocal({ run, binding, request, snapshot, cursors });
  }

  /** Closes original-file streams when their worker has confirmed completion. */
  public close(jobId: string): void {
    this.cursors.get(jobId)?.access.close();
    this.cursors.delete(jobId);
  }

  private async loadSnapshot(
    job: RunnerJob,
    runId: string,
  ): Promise<AgentPlanSnapshot> {
    const reference = job.execution?.managed?.files;
    return readPlanSnapshot(
      reference
        ? JSON.parse(await this.dependencies.readBody(reference))
        : await this.dependencies.runs.snapshot(runId),
    );
  }

  private async receiveLocal(options: {
    readonly run: AgentPlanRun;
    readonly binding: NonNullable<RunnerJob["plan"]>;
    readonly request: ManagedFileRequest;
    readonly snapshot: AgentPlanSnapshot;
    readonly cursors: RunnerAssetCursors;
  }): Promise<unknown> {
    const { run, binding, request, snapshot, cursors } = options;
    const step = snapshot.steps.find(
      (entry) => entry.step.id === binding.stepId,
    );
    const files = await this.dependencies.local.readTicketAssets(
      run.userId,
      step?.prepared.parameters.assetInputs ?? [],
    );
    const manifest = files.map((file) => manifestFile(file));
    if (request.kind === "prepare") return { files: manifest };
    const file = files[request.index];
    const identity = manifest[request.index];
    if (!file || !identity) throw new AgentError("parameter_asset_unavailable");
    const bytes = await readChunk(file, identity, request, cursors);
    if (request.offset > identity.size)
      throw new AgentError("parameter_asset_unavailable");
    await this.dependencies.evidence.write(
      run.id,
      binding.recordingAttemptId ?? binding.attemptId,
      (previous) => ({
        pages: "active",
        events: previous?.events ?? [],
        files: [
          ...(previous?.files ?? []).filter(
            (entry) => entry.digest !== identity.digest,
          ),
          identity,
        ],
      }),
    );
    return {
      base64: bytes.toString("base64"),
      size: identity.size,
      done: request.offset + bytes.length === identity.size,
    };
  }

  private forJob(jobId: string): RunnerAssetCursors {
    for (const [id, entry] of this.cursors)
      if (Date.now() - entry.touchedAt > 60_000) {
        entry.access.close();
        this.cursors.delete(id);
      }
    const current = this.cursors.get(jobId)?.access ?? new RunnerAssetCursors();
    this.cursors.set(jobId, { access: current, touchedAt: Date.now() });
    return current;
  }
}

type ManagedFileRequest = Extract<
  RunnerPagesRequest["request"],
  { kind: "prepare" | "asset" }
>;

type ManagedAssetRequest = Extract<
  RunnerPagesRequest["request"],
  { kind: "asset" }
>;

type ManagedTicketFile = Awaited<
  ReturnType<AgentParameterService["readTicketAssets"]>
>[number];

type ManagedFileIdentity = ReturnType<typeof remoteAssetFile> & {
  readonly textExtract?: string;
};

function manifestFile(file: ManagedTicketFile): ManagedFileIdentity {
  if (!file.original)
    throw new AgentError("parameter_asset_transfer_unsupported");
  return {
    ...remoteAssetFile(file.parameter, file.asset, {
      ...file,
      original: file.original,
    }),
    textExtract:
      file.content.type === "text" &&
      file.content.representation === "text-extract"
        ? file.content.text
        : undefined,
  };
}

async function readChunk(
  file: ManagedTicketFile,
  identity: ManagedFileIdentity,
  request: ManagedAssetRequest,
  cursors: RunnerAssetCursors,
): Promise<Buffer> {
  if (file.bytes)
    return Buffer.from(file.bytes).subarray(
      request.offset,
      request.offset + FILE_CHUNK_BYTES,
    );
  const open = file.open;
  if (!open) throw new AgentError("parameter_asset_unavailable");
  return cursors.read(request.index, request.offset, FILE_CHUNK_BYTES, {
    ...identity,
    open: async () => {
      const stream = await open();
      if (!(stream instanceof Readable))
        throw new AgentError("parameter_asset_unavailable");
      return stream;
    },
  });
}
