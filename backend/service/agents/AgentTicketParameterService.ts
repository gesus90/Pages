import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { digestStream } from "@/backend/storage/StreamDigest";

import { PLAN_HANDOVER_LIMITS } from "@/definition/AgentPlanHandover";

import {
  ticketAssetReferences,
  externalAssetNotes,
  requireAssetReferences,
  reportTicketAssetChanges,
} from "./AgentTicketAssetReferences";

import type { AgentTicketChoice } from "@/definition/AgentParameters";
import type { AgentTaskContext } from "./AgentTaskAccess";
import type {
  AgentTicketAssetService,
  AgentTicketAssetBytes,
  AgentTicketAssetStream,
} from "./AgentTicketAssetService";
import type { AgentTicketAssetSnapshots } from "./AgentTicketAssetSnapshots";
import type {
  ResolvedAgentTicket,
  AgentTicketInput,
  AgentTicketAssetContent,
  AgentTicketAsset,
  AgentTicketAssetSnapshot,
} from "@/definition/AgentTicketParameter";

interface TicketParameterContext {
  readonly actor: AgentTaskContext["actor"];
  readonly tasks: Pick<
    AgentTaskContext["tasks"],
    "findAll" | "getById" | "findChecklistItems"
  >;
}

/** Complete ticket input, including description task lists and separately stored acceptance criteria. */
export type AgentTicketParameterText = ResolvedAgentTicket;

/** Resolves ticket references through the existing ticket service and the executor's live rights. */
export class AgentTicketParameterService {
  private readonly wiki:
    | ((
        userId: string,
        pageId: string,
      ) => Promise<{ readonly markdown: string; readonly version: string }>)
    | undefined;
  private readonly context: (userId: string) => Promise<TicketParameterContext>;
  private readonly assets: Pick<
    AgentTicketAssetService,
    "references" | "readForHandover" | "requireReadable"
  > &
    Partial<Pick<AgentTicketAssetService, "stream">>;
  private readonly snapshots: AgentTicketAssetSnapshots | undefined;

  public constructor(
    context: (userId: string) => Promise<TicketParameterContext>,
    assets: AgentTicketParameterService["assets"],
    wiki?: AgentTicketParameterService["wiki"],
    snapshots?: AgentTicketAssetSnapshots,
  ) {
    this.context = context;
    this.wiki = wiki;
    this.assets = assets;
    this.snapshots = snapshots;
  }

  /** Freezes ticket originals once; only copy identities, never binary contents, enter a run snapshot. */
  public async pinAssets(
    userId: string,
    inputs: readonly AgentTicketInput[],
  ): Promise<readonly AgentTicketInput[]> {
    if (!this.snapshots) return inputs;
    const pinned: AgentTicketInput[] = [];
    const contents = await this.readAssets(userId, inputs);
    for (const input of inputs) {
      if (
        input.owner === "wiki" ||
        input.owner === "asset" ||
        !this.snapshots
      ) {
        pinned.push(input);
        continue;
      }
      const snapshots: Record<string, AgentTicketAssetSnapshot> = {};
      for (const file of contents.filter(
        (entry) => entry.parameter === input.parameter,
      )) {
        if (!file.original)
          throw new AgentError("parameter_asset_transfer_unsupported");
        snapshots[`${file.asset.source}:${file.asset.id}`] =
          await this.snapshots.pin(
            { ...file, original: file.original },
            file.asset,
          );
      }
      pinned.push({
        ...input,
        snapshots,
        originals: Object.fromEntries(
          Object.entries(snapshots).map(([key, file]) => [
            key,
            file.original.digest,
          ]),
        ),
      });
    }
    return pinned;
  }

  /** Lists active tickets the authenticated person may currently read. */
  public async choices(userId: string): Promise<readonly AgentTicketChoice[]> {
    const { actor, tasks } = await this.context(userId);
    if (!actor.isActive) throw new AgentError("agent_usage_denied");
    return (await tasks.findAll(actor, { archived: "active" })).map(
      (ticket) => ({
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
      }),
    );
  }

  /** Resolves the entire ticket without trimming its description or silently substituting another ticket. */
  public async resolve(
    userId: string,
    ticketId: string,
  ): Promise<AgentTicketParameterText> {
    try {
      const { actor, tasks } = await this.context(userId);
      if (!actor.isActive) throw new AgentError("parameter_ticket_unavailable");
      const ticket = await tasks.getById(actor, ticketId);
      if (ticket.archivedAt !== null)
        throw new AgentError("parameter_ticket_unavailable");
      const criteria = await tasks.findChecklistItems(actor, ticket.id);
      const acceptance = criteria
        .map((item) => `- [${item.isDone ? "x" : " "}] ${item.title}`)
        .join("\n");
      return {
        id: ticket.id,
        key: ticket.key,
        title: ticket.title,
        description: ticket.description,
        assets: await this.assets.references(
          actor,
          ticket.id,
          ticket.description,
        ),
        markdown: `# ${ticket.key}: ${ticket.title}\n\n${ticket.description}${externalAssetNotes(ticket.description)}${acceptance ? `\n\n## Acceptance criteria\n\n${acceptance}` : ""}`,
        version: JSON.stringify([ticket.updatedAt, criteria]),
      };
    } catch (error: unknown) {
      logCaughtError("AgentTicketParameterService", error);

      if (error instanceof AgentError) throw error;
      throw new AgentError("parameter_ticket_unavailable");
    }
  }

  /**
   * Rechecks ticket-owner rights for each transmission and serves the first attempt's verified copies.
   *
   * @remarks
   * A step receives up to 64 files and 512 MiB of originals. The first 10 MiB
   * are read into memory and offered to the model; every further file is
   * measured as a stream and carried as an original file only, so memory stays
   * bounded however large the handover is.
   */
  public async readAssets(
    userId: string,
    inputs: readonly AgentTicketInput[],
  ): Promise<readonly AgentTicketAssetContent[]> {
    const contents: AgentTicketAssetContent[] = [];
    let size = 0;
    let inlineBytes: number = PLAN_HANDOVER_LIMITS.inlineBytes;
    for (const input of inputs) {
      const ticket = await this.ownerInput(userId, input);
      await this.checkReferences(userId, input, ticket);
      for (const asset of input.ticket.assets) {
        const file = await this.readAsset(userId, input, asset, inlineBytes);
        size += file.size;
        if (
          size > PLAN_HANDOVER_LIMITS.bytes ||
          contents.length >= PLAN_HANDOVER_LIMITS.files
        )
          throw new AgentAssetError(
            "parameter_assets_too_large",
            asset,
            file.fileName,
          );
        if ("bytes" in file) inlineBytes -= file.size;
        contents.push({
          parameter: input.parameter,
          ticketId: ticket.id,
          ticketKey: ticket.key,
          asset,
          fileName: file.fileName,
          owner: { type: input.owner ?? "ticket", id: ticket.id },
          content: file.content,
          original: file.original,
          ...("bytes" in file ? { bytes: file.bytes } : { open: file.open }),
        });
      }
    }
    return contents;
  }

  /** Historical results retain the original file references even after a description removes its links. */
  public async requireAssets(
    userId: string,
    assets: readonly AgentTicketAsset[],
  ): Promise<void> {
    for (const asset of assets) {
      const { actor } = await this.context(userId);
      if (!actor.isActive) throw new AgentError("parameter_asset_unavailable");
      await this.assets.requireReadable(actor, asset);
    }
  }

  private async readAsset(
    userId: string,
    input: AgentTicketInput,
    asset: AgentTicketAsset,
    inlineBytes: number,
  ): Promise<AgentTicketAssetBytes | AgentTicketAssetStream> {
    const { actor } = await this.context(userId);
    if (!actor.isActive) throw new AgentError("parameter_asset_unavailable");
    const snapshot = input.snapshots?.[`${asset.source}:${asset.id}`];
    if (input.snapshots && (!snapshot || !this.snapshots))
      throw new AgentError("parameter_ticket_changed");
    const file =
      snapshot && this.snapshots
        ? await this.snapshots.read(snapshot, inlineBytes, asset)
        : await this.assets.readForHandover(actor, asset, inlineBytes);
    const expected = input.originals?.[`${asset.source}:${asset.id}`];
    if (expected !== undefined && expected !== file.original.digest)
      throw new AgentAssetError(
        input.owner === "asset"
          ? "plan_asset_changed"
          : "parameter_ticket_changed",
        asset,
        file.fileName,
      );
    return file;
  }

  private async checkReferences(
    userId: string,
    input: AgentTicketInput,
    ticket: ResolvedAgentTicket,
  ): Promise<void> {
    if (input.snapshots && this.snapshots) {
      const { actor } = await this.context(userId);
      await this.snapshots.reportChanges(
        input,
        ticket.assets,
        async (asset) => {
          if (this.assets.stream)
            return (
              await digestStream(
                await this.assets.stream(actor, asset),
                PLAN_HANDOVER_LIMITS.bytes,
              )
            ).digest;
          return (
            await this.assets.readForHandover(
              actor,
              asset,
              PLAN_HANDOVER_LIMITS.inlineBytes,
            )
          ).original.digest;
        },
      );
    } else if (input.owner === "wiki" || input.owner === "asset")
      requireAssetReferences(input.ticket.assets, ticket.assets);
    else reportTicketAssetChanges(input.ticket.assets, ticket.assets);
  }

  /**
   * The current owner of the files: the ticket or wiki page read again, or
   * for a plan asset the pinned input, whose file read rechecks the rights.
   */
  private async ownerInput(
    userId: string,
    input: AgentTicketInput,
  ): Promise<ResolvedAgentTicket> {
    if (input.owner === "asset") return input.ticket;
    return input.owner === "wiki"
      ? this.wikiInput(userId, input.ticket)
      : this.resolve(userId, input.ticket.id);
  }

  private async wikiInput(
    userId: string,
    pinned: ResolvedAgentTicket,
  ): Promise<ResolvedAgentTicket> {
    if (!this.wiki) throw new AgentError("parameter_reference_unavailable");
    const current = await this.wiki(userId, pinned.id);
    return { ...pinned, assets: ticketAssetReferences(current.markdown) };
  }
}
