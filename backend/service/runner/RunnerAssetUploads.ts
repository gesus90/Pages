import { createHash } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";

import type { AgentAsset } from "@/definition/PagesAgentWrites";

interface PendingUpload {
  readonly chunks: Buffer[];
  size: number;
}

interface OutputReservation {
  readonly digest: string;
  size: number;
  isCommitted: boolean;
}

/** Binary-channel chunks; these are never arguments of a normal Pages MCP operation. */
export interface RunnerAssetUploadChunk {
  readonly ticket: string;
  readonly offset: number;
  readonly base64: string;
  readonly done: boolean;
  readonly digest: string;
}

/** Bounds both in-flight memory and unique outputs; response-loss replays retain their original quota. */
export class RunnerAssetUploads {
  private readonly uploads = new Map<string, PendingUpload>();
  private readonly outputs = new Map<string, OutputReservation>();
  private readonly aliases = new Map<string, string>();
  private readonly names = new Map<string, string>();
  private readonly publish:
    ((ticket: string, bytes: Buffer) => Promise<AgentAsset>) | undefined;

  public constructor(
    publish?: (ticket: string, bytes: Buffer) => Promise<AgentAsset>,
  ) {
    this.publish = publish;
  }

  /** Only metadata accepted by the authenticated upload service may bind a replay operation. */
  public register(
    attemptId: string,
    ticket: string,
    operationId: string,
    fileName = "output",
  ): void {
    this.names.set(`${attemptId}:${ticket}`, fileName);
    this.aliases.set(
      `${attemptId}:${ticket}`,
      `${attemptId}:operation:${operationId}`,
    );
  }

  /** Returns only a name already authorized for this attempt's upload capability. */
  public fileName(attemptId: string, ticket: string): string {
    return this.names.get(`${attemptId}:${ticket}`) ?? "output";
  }

  /** Checks sequence, canonical encoding and the full digest before invoking durable storage. */
  public async receive(
    attemptId: string,
    input: RunnerAssetUploadChunk,
  ): Promise<AgentAsset | { readonly offset: number }> {
    if (!this.publish) throw new AgentError("plan_mcp_unavailable");
    const key = `${attemptId}:${input.ticket}`;
    const outputKey = this.aliases.get(key) ?? key;
    const upload = this.uploads.get(key) ?? { chunks: [], size: 0 };
    const bytes = Buffer.from(input.base64, "base64");
    if (
      input.offset !== upload.size ||
      bytes.length > 32768 ||
      bytes.toString("base64") !== input.base64
    )
      throw new AgentError("parameter_asset_unavailable");
    const reservation = this.reserve({
      attemptId,
      key,
      outputKey,
      upload,
      bytes,
      digest: input.digest,
    });
    upload.chunks.push(bytes);
    upload.size += bytes.length;
    this.uploads.set(key, upload);
    if (!input.done) return { offset: upload.size };
    this.uploads.delete(key);
    try {
      const complete = Buffer.concat(upload.chunks);
      if (createHash("sha256").update(complete).digest("hex") !== input.digest)
        throw new AgentError("parameter_asset_unavailable");
      const result = await this.publish(input.ticket, complete);
      reservation.isCommitted = true;
      return result;
    } catch (error: unknown) {
      if (!reservation.isCommitted) this.outputs.delete(outputKey);
      throw error;
    }
  }

  /** Confirmed close removes transient buffers, quota reservations and aliases, never permanent attachments. */
  public close(attemptId: string): void {
    const prefix = `${attemptId}:`;
    for (const key of this.uploads.keys())
      if (key.startsWith(prefix)) this.uploads.delete(key);
    for (const key of this.outputs.keys())
      if (key.startsWith(prefix)) this.outputs.delete(key);
    for (const key of this.names.keys())
      if (key.startsWith(prefix)) this.names.delete(key);
    for (const key of this.aliases.keys())
      if (key.startsWith(prefix)) this.aliases.delete(key);
  }

  private reserve(input: {
    readonly attemptId: string;
    readonly key: string;
    readonly outputKey: string;
    readonly upload: PendingUpload;
    readonly bytes: Buffer;
    readonly digest: string;
  }): OutputReservation {
    const previous = this.outputs.get(input.outputKey);
    if (previous && previous.digest !== input.digest)
      throw new AgentError("parameter_ticket_changed");
    const size = Math.max(
      previous?.size ?? 0,
      input.upload.size + input.bytes.length,
    );
    const prefix = `${input.attemptId}:`;
    const otherOutputs = [...this.outputs].filter(
      ([key]) => key.startsWith(prefix) && key !== input.outputKey,
    );
    const memory = [...this.uploads]
      .filter(([key]) => key.startsWith(prefix))
      .reduce((total, [, upload]) => total + upload.size, input.bytes.length);
    const outputBytes = otherOutputs.reduce(
      (total, [, output]) => total + output.size,
      size,
    );
    if (
      otherOutputs.length >= 64 ||
      outputBytes > 10 * 1024 * 1024 ||
      memory > 10 * 1024 * 1024 ||
      (!this.uploads.has(input.key) && this.uploads.size >= 64)
    )
      throw new AgentError("parameter_assets_too_large");
    const reservation = previous ?? {
      digest: input.digest,
      size,
      isCommitted: false,
    };
    reservation.size = size;
    this.outputs.set(input.outputKey, reservation);
    return reservation;
  }
}
