import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { AcpCleanupUnconfirmedError } from "@/backend/error/AcpCleanupUnconfirmedError";
import { AgentAssetError } from "@/backend/error/AgentAssetError";
import { AgentError } from "@/backend/error/AgentErrors";
import { sanitizeFileName } from "@/backend/service/wiki/WikiFileTypes";

import type { AgentPlanSessionInput } from "@/backend/agents/AgentPlanExecution";
import type { PlanSession } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentTicketAssetContent } from "@/definition/AgentTicketParameter";

/** Owns only copies created for one authorized native session; no host file reference is accepted. */
export class CliAssetWorkspace {
  private readonly directory: string;
  private readonly copies = new Set<string>();

  public constructor(directory: string) {
    this.directory = directory;
  }

  /** Materializes complete originals before namespace creation, including for read-only sessions. */
  public async prepare<
    Input extends Pick<
      AgentPlanExecutionInput,
      "readTicketAssets" | "beforeStart"
    >,
  >(input: Input): Promise<Input> {
    if (!input.readTicketAssets) return input;
    await input.beforeStart?.();
    const assets = await input.readTicketAssets();
    if (!assets.length) return input;
    const root = await realpath(this.directory);
    const directory = await mkdtemp(path.join(root, ".pages-assets-"));
    this.copies.add(directory);
    const paths = new Map<
      string,
      { readonly path: string; readonly digest: string; readonly size: number }
    >();
    for (const [index, asset] of assets.entries()) {
      const bytes = originalBytes(asset);
      const target = path.join(
        directory,
        `${index}-${workspaceName(asset.fileName)}`,
      );
      await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
      paths.set(`${asset.parameter}:${asset.asset.source}:${asset.asset.id}`, {
        path: target,
        digest: digest(bytes),
        size: bytes.length,
      });
    }
    const read = input.readTicketAssets;
    return {
      ...input,
      readTicketAssets: async () => {
        const current = await read();
        return Promise.all(
          current.map(async (asset) => {
            const stored = paths.get(
              `${asset.parameter}:${asset.asset.source}:${asset.asset.id}`,
            );
            if (!stored || digest(originalBytes(asset)) !== stored.digest)
              throw new AgentError("parameter_ticket_changed");
            try {
              await verifyCopy(stored);
            } catch {
              throw new AgentAssetError(
                "parameter_ticket_changed",
                asset.asset,
                asset.fileName,
              );
            }
            return { ...asset, path: stored.path };
          }),
        );
      },
    };
  }

  /** Called only after process cleanup was confirmed; published attachments are never in this set. */
  public async cleanup(): Promise<void> {
    for (const directory of this.copies) {
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new Error("Asset directory changed");
      await rm(directory, { recursive: true });
      this.copies.delete(directory);
    }
  }
}

function originalBytes(asset: AgentTicketAssetContent): Buffer {
  if (asset.bytes) return Buffer.from(asset.bytes);
  if (asset.content.type === "image")
    return Buffer.from(asset.content.base64, "base64");
  if (
    asset.content.type === "text" &&
    asset.content.representation !== "text-extract"
  )
    return Buffer.from(asset.content.text, "utf8");
  throw new AgentError("parameter_asset_unavailable");
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
/** Retains copies until the session's own process cleanup is confirmed, including reused turns. */
export function assetSession(
  session: PlanSession,
  assets: CliAssetWorkspace | null,
): PlanSession {
  if (!assets) return session;
  return {
    turn: session.turn,
    terminated: session.terminated,
    steer: session.steer?.bind(session),
    next: session.next
      ? async (input, signal, observer) => {
          const prepared = await assets.prepare(input);
          if (!session.next) throw new AgentError("plan_run_unavailable");
          return session.next(prepared, signal, observer);
        }
      : undefined,
    close: async () => {
      const closed = await session.close();
      if (closed.isConfirmed) await assets.cleanup();
      return closed;
    },
  };
}

/** Pica's own sandbox never receives general workspace copies. */
export function sessionAssetWorkspace(
  input: AgentPlanSessionInput,
): CliAssetWorkspace | null {
  return input.chat ? null : new CliAssetWorkspace(input.directory);
}

/** Preserves the input object when the session has no permitted filesystem handoff. */
export async function prepareSessionAssets(
  input: AgentPlanSessionInput,
  assets: CliAssetWorkspace | null,
): Promise<AgentPlanSessionInput> {
  return assets ? assets.prepare(input) : input;
}

/** Unconfirmed processes retain their resources for the existing cleanup/recovery path. */
export async function cleanupSessionAssets(
  assets: CliAssetWorkspace | null,
  error: unknown,
): Promise<void> {
  if (assets && !(error instanceof AcpCleanupUnconfirmedError))
    await assets.cleanup();
}

async function verifyCopy(stored: {
  readonly path: string;
  readonly digest: string;
  readonly size: number;
}): Promise<void> {
  if ((await realpath(stored.path)) !== stored.path)
    throw new Error("Asset symlink refused");
  const file = await open(
    stored.path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size !== stored.size)
      throw new Error("Asset copy changed");
    const buffer = Buffer.alloc(stored.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await lstat(stored.path);
    if (
      after.isSymbolicLink() ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      digest(buffer.subarray(0, offset)) !== stored.digest
    )
      throw new Error("Asset copy changed");
  } finally {
    await file.close();
  }
}

function workspaceName(fileName: string): string {
  const characters = Array.from(sanitizeFileName(fileName));
  while (Buffer.byteLength(characters.join("")) > 160) characters.pop();
  return characters.join("") || "file";
}
