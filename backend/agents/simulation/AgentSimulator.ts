import { setTimeout as delay } from "node:timers/promises";

import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentSimulationRunner } from "@/definition/AgentSimulation";
import { planAssetLink } from "@/backend/service/agents/assets/PlanAssetInput";
import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";
import { collectStream } from "@/backend/storage/StreamBytes";
import { digestStream } from "@/backend/storage/StreamDigest";

import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { PlanAssetService } from "@/backend/service/agents/assets/PlanAssetService";
import type { PlanAssetReferences } from "@/backend/service/agents/assets/PlanAssetReferences";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";
import type { AgentSimulationMode } from "./AgentSimulationMode";

/** One file the simulated agent really read; a file beyond the in-memory budget is measured, not kept. */
interface ReadFile {
  readonly asset: AgentTicketAsset;
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly bytes: Buffer | null;
}

/** The services the simulated agent and its simulated runner use. */
export interface AgentSimulatorDependencies {
  readonly mode: AgentSimulationMode;
  readonly assets: Pick<PlanAssetService, "describe" | "storeResult">;
  readonly references: Pick<PlanAssetReferences, "issue" | "redeem">;
}

const SLOW_DELAY_MS = 5_000;

/**
 * The simulated agent of the development simulation (PAGE-268).
 *
 * @remarks
 * It runs where a request to an API model would run, with the same prepared
 * input, and contacts no model provider. It reads every handed-over file for
 * real and writes `ergebnis-<name>` with the input's content as a result file
 * of the run. The local runner reads the files through the authorized asset
 * handover; the simulated remote runner gets only signed references and
 * redeems them, exactly what a remote runner could do, never a path.
 */
export class AgentSimulator {
  private readonly dependencies: AgentSimulatorDependencies;

  public constructor(dependencies: AgentSimulatorDependencies) {
    this.dependencies = dependencies;
  }

  /** Runs one turn and returns the answer the node records as its result. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const runner = agentSimulationRunner(input.agent.connection.id) ?? "local";
    const { scenario } = this.dependencies.mode;
    await input.beforeStart?.();
    if (scenario === "slow") await delay(SLOW_DELAY_MS, undefined, { signal });
    const files =
      runner === "remote"
        ? await this.readThroughReferences(input)
        : await this.readLocally(input);
    signal.throwIfAborted();
    for (const file of files)
      if (scenario === "item_failed" && /^defekt/iu.test(file.fileName))
        throw new AgentAssetError(
          "plan_simulation_item_failed",
          file.asset,
          file.fileName,
        );
    const lines = [
      `Simulation (${runner === "remote" ? "Remote-Runner" : "lokal"}, Szenario ${scenario}): kein Modellanbieter wurde angefragt.`,
    ];
    if (files.length === 0)
      lines.push("Keine Datei übergeben; die Aufgabe blieb unverändert.");
    for (const file of files) lines.push(await this.result(input, file));
    return lines.join("\n");
  }

  /** The local runner: the authorized handover of the step, read and checked by Pages. */
  private async readLocally(
    input: AgentPlanExecutionInput,
  ): Promise<readonly ReadFile[]> {
    if (!input.readTicketAssets) return [];
    const contents = await input.readTicketAssets();
    return contents.map((content) => ({
      asset: content.asset,
      fileName: content.fileName,
      mediaType: content.original?.mimeType ?? "application/octet-stream",
      size: content.original?.size ?? content.bytes?.length ?? 0,
      bytes: content.bytes ? Buffer.from(content.bytes) : null,
    }));
  }

  /**
   * The simulated remote runner: Pages issues one reference per file; the
   * runner side holds nothing but the reference and redeems it.
   */
  private async readThroughReferences(
    input: AgentPlanExecutionInput,
  ): Promise<readonly ReadFile[]> {
    const references = await this.issueReferences(input);
    const files: ReadFile[] = [];
    for (const { asset, fileName, reference } of references) {
      try {
        const redeemed = await this.dependencies.references.redeem(reference);
        files.push({
          asset,
          fileName: redeemed.fileName,
          mediaType: redeemed.mediaType,
          size: redeemed.size,
          bytes: await receivedBytes(redeemed),
        });
      } catch (error: unknown) {
        if (error instanceof AgentError)
          throw new AgentAssetError(error.code, asset, fileName);
        throw error;
      }
    }
    return files;
  }

  private async issueReferences(input: AgentPlanExecutionInput): Promise<
    readonly {
      readonly asset: AgentTicketAsset;
      readonly fileName: string;
      readonly reference: string;
    }[]
  > {
    const context = input.resourceContext;
    const issued = [];
    for (const ticketInput of input.ticketInputs ?? []) {
      if (ticketInput.owner !== "asset") continue;
      for (const asset of ticketInput.ticket.assets)
        issued.push({
          asset,
          fileName: ticketInput.ticket.title,
          reference: await this.dependencies.references.issue(input.userId, {
            assetId: asset.id,
            digest: ticketInput.originals?.[`plan:${asset.id}`] ?? "",
            runId: context?.runId ?? "",
            stepId: context?.stepId ?? "",
          }),
        });
    }
    return issued;
  }

  /** Writes the result file of one input and names input and result. */
  private async result(
    input: AgentPlanExecutionInput,
    file: ReadFile,
  ): Promise<string> {
    const described =
      file.asset.source === "plan"
        ? await this.dependencies.assets.describe(input.userId, file.asset.id)
        : null;
    const facts = `${file.fileName} · ${described?.kind ?? "file"} · ${file.mediaType} · ${file.size} Bytes`;
    if (file.bytes === null)
      return `- Eingabe: ${facts} (als Originaldatei übergeben, keine Ergebnisdatei)`;
    if (!described || !input.resourceContext)
      return `- Eingabe: ${facts} (gelesen, keine Ergebnisdatei)`;
    const stored = await this.dependencies.assets.storeResult(input.userId, {
      projectId: described.projectId,
      fileName: `ergebnis-${file.fileName}`,
      bytes: file.bytes,
      origin: {
        runId: input.resourceContext.runId,
        stepId: input.resourceContext.stepId,
        sourceAssetId: file.asset.id,
      },
    });
    return `- Eingabe: ${facts}\n- Ergebnis: ${stored.fileName} (${planAssetLink(stored.assetId)})`;
  }
}

/** Keeps a redeemed file in memory only within the in-memory budget; a larger one is read through and measured. */
async function receivedBytes(
  redeemed: Awaited<ReturnType<PlanAssetReferences["redeem"]>>,
): Promise<Buffer | null> {
  if (redeemed.size <= PLAN_HANDOVER_LIMITS.inlineBytes)
    return collectStream(redeemed.stream, redeemed.size);
  await digestStream(redeemed.stream, redeemed.size);
  return null;
}
