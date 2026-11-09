import type {
  AgentPlanAssetFile,
  AgentPlanAssetRecord,
} from "@/definition/AgentPlanAsset";

/** Thrown when an upload fails; the code names the reason for the person. */
export class PlanAssetUploadError extends Error {
  /** A code of `settings.agents.error`, or `network`. */
  public readonly code: string;

  /**
   * Creates the error.
   *
   * @param code - Reason of the failure.
   */
  public constructor(code: string) {
    super(`Plan asset upload failed: ${code}`);
    this.name = "PlanAssetUploadError";
    this.code = code;
  }
}

/** The address that serves the bytes of a plan asset to a person who may read it. */
export function planAssetUrl(assetId: string): string {
  return `/agent-plan-assets/${encodeURIComponent(assetId)}`;
}

function readRecord(text: string): {
  readonly asset?: AgentPlanAssetRecord;
  readonly error?: string;
} {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== "object" || body === null) return {};
    const asset: unknown = Reflect.get(body, "asset");
    const error: unknown = Reflect.get(body, "error");
    return {
      ...(typeof asset === "object" && asset !== null
        ? { asset: asset as AgentPlanAssetRecord }
        : {}),
      ...(typeof error === "string" ? { error } : {}),
    };
  } catch {
    return {};
  }
}

/** The part of a stored record a node or stack entry keeps. */
function fileOf(record: AgentPlanAssetRecord): AgentPlanAssetFile {
  return {
    assetId: record.assetId,
    fileName: record.fileName,
    mediaType: record.mediaType,
    kind: record.kind,
    size: record.size,
    digest: record.digest,
  };
}

/**
 * Sends a file for an asset node or stack entry and reports the progress.
 *
 * @param projectId - The project of the plan; the server checks access to it.
 * @param file - The file the person dropped or chose.
 * @param onProgress - Called with the share that was sent, from 0 to 1.
 * @returns The stored file as the server detected it.
 * @throws {PlanAssetUploadError} When the server refuses the file or cannot be reached.
 */
export function uploadPlanAsset(
  projectId: string,
  file: File,
  onProgress: (share: number) => void,
): Promise<AgentPlanAssetFile> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "PUT",
      `/agent-api/plan-assets?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(file.name)}`,
    );
    request.upload.onprogress = (event) => {
      onProgress(event.lengthComputable ? event.loaded / event.total : 0);
    };
    request.onerror = () => reject(new PlanAssetUploadError("network"));
    request.onload = () => {
      const body = readRecord(request.responseText);
      if (request.status >= 200 && request.status < 300 && body.asset)
        resolve(fileOf(body.asset));
      else reject(new PlanAssetUploadError(body.error ?? "network"));
    };
    request.send(file);
  });
}

/**
 * Asks whether the person may still read a file and whether its bytes are there.
 *
 * @returns `readable`, `unreadable` for missing bytes, `missing` for an
 * unknown or refused file, `changed` when its content is not the one chosen.
 */
export async function checkPlanAsset(
  file: Pick<AgentPlanAssetFile, "assetId" | "digest">,
  signal: AbortSignal,
): Promise<"readable" | "unreadable" | "missing" | "changed"> {
  const response = await fetch(
    `/agent-api/plan-assets?id=${encodeURIComponent(file.assetId)}`,
    { signal, headers: { Accept: "application/json" } },
  );
  if (!response.ok) return "missing";
  const text = await response.text();
  const { asset } = readRecord(text);
  if (!asset) return "missing";
  if (asset.digest !== file.digest) return "changed";
  const body: unknown = JSON.parse(text);
  return Reflect.get(Object(body), "isReadable") === true
    ? "readable"
    : "unreadable";
}
