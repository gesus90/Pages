import { GoogleDriveSimulation } from "@/backend/google/GoogleDriveSimulation";

import type { GoogleDriveSimulationScenario } from "@/backend/google/GoogleDriveSimulationConfig";

export const DRIVE_ORIGIN = "https://www.googleapis.com";

/** One answer of the simulated Drive, with its JSON body if it has one. */
export interface DriveAnswer {
  readonly status: number;
  readonly response: Response;
  readonly json: Record<string, unknown>;
}

/** One request to the simulated Drive. */
export interface DriveCall {
  readonly method?: string;
  readonly query?: Record<string, string>;
  readonly body?: BodyInit;
  readonly headers?: Record<string, string>;
}

/** The storage quota of an `about` answer, as the numbers Drive reports. */
export interface DriveQuota {
  readonly limit: string;
  readonly usage: string;
  readonly usageInDrive: string;
  readonly usageInDriveTrash: string;
}

/** The fields of a listed file the tests read. */
export interface DriveListedFile {
  readonly name: string;
  readonly capabilities: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Creates a simulated Drive in its starting state.
 *
 * @param scenario - How the simulated Drive behaves.
 * @returns The simulation.
 */
export function createSimulation(
  scenario: GoogleDriveSimulationScenario = "full",
): GoogleDriveSimulation {
  return new GoogleDriveSimulation(scenario);
}

/**
 * Calls the simulated Drive at its fetch seam and reads a JSON answer if any.
 *
 * @param simulation - The simulated Drive.
 * @param path - Path below the Drive origin.
 * @param call - Method, query, body and headers.
 * @returns Status, raw response and the parsed JSON body (empty if none).
 */
export async function callDrive(
  simulation: GoogleDriveSimulation,
  path: string,
  call: DriveCall = {},
): Promise<DriveAnswer> {
  const url = new URL(path, DRIVE_ORIGIN);

  for (const [name, value] of Object.entries(call.query ?? {})) {
    url.searchParams.set(name, value);
  }

  const response = await simulation.fetch(url.toString(), {
    body: call.body,
    headers: call.headers,
    method: call.method,
  });
  const text = await response.clone().text();
  let parsed: unknown = {};

  try {
    parsed = text === "" ? {} : JSON.parse(text);
  } catch {
    // Media answers are not JSON; the tests read them from the raw response.
    parsed = {};
  }

  return { json: asRecord(parsed), response, status: response.status };
}

/**
 * Serializes a JSON request body.
 *
 * @param value - Any JSON value.
 * @returns The body text.
 */
export function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Builds a Drive `multipart` upload body of metadata and media.
 *
 * @param metadata - The metadata part.
 * @param content - The media part.
 * @param mediaType - Type of the media part.
 * @returns Body and headers.
 */
export function multipartUpload(
  metadata: unknown,
  content: string,
  mediaType = "text/plain",
): { readonly body: string; readonly headers: Record<string, string> } {
  const boundary = "sim-boundary";

  return {
    body: [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mediaType}`,
      "",
      content,
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
  };
}

/**
 * Reads the files of a `drive#fileList` answer.
 *
 * @param answer - The list answer.
 * @returns Name and capabilities of every listed file.
 */
export function listedFiles(answer: DriveAnswer): DriveListedFile[] {
  const files = answer.json["files"];

  return (Array.isArray(files) ? files : []).map((entry) => {
    const file = asRecord(entry);

    return {
      capabilities: asRecord(file["capabilities"]),
      name: asText(file["name"]),
    };
  });
}

/**
 * Reads the names of a `drive#fileList` answer in answer order.
 *
 * @param answer - The list answer.
 * @returns The names.
 */
export function fileNames(answer: DriveAnswer): string[] {
  return listedFiles(answer).map((file) => file.name);
}

/**
 * Reads the identifier of a file answer.
 *
 * @param answer - The file answer.
 * @returns Its `id`, or an empty text.
 */
export function idOf(answer: DriveAnswer): string {
  return asText(answer.json["id"]);
}

/**
 * Reads Drive's `reason` of an error answer.
 *
 * @param answer - The error answer.
 * @returns The first error reason, or an empty text.
 */
export function reasonOf(answer: DriveAnswer): string {
  const errors = asRecord(answer.json["error"])["errors"];

  return Array.isArray(errors) ? asText(asRecord(errors[0])["reason"]) : "";
}

/**
 * Reads Drive's message of an error answer.
 *
 * @param answer - The error answer.
 * @returns The message, or an empty text.
 */
export function messageOf(answer: DriveAnswer): string {
  return asText(asRecord(answer.json["error"])["message"]);
}

/**
 * Reads the capabilities of a file answer.
 *
 * @param answer - The file answer.
 * @returns The capability flags.
 */
export function capabilitiesOf(answer: DriveAnswer): Record<string, unknown> {
  return asRecord(answer.json["capabilities"]);
}

/**
 * Reads the storage quota of an `about` answer.
 *
 * @param answer - The about answer.
 * @returns The quota with its byte counts as numbers.
 */
export function quotaOf(answer: DriveAnswer): Record<keyof DriveQuota, number> {
  const quota = asRecord(answer.json["storageQuota"]);

  return {
    limit: Number(quota["limit"]),
    usage: Number(quota["usage"]),
    usageInDrive: Number(quota["usageInDrive"]),
    usageInDriveTrash: Number(quota["usageInDriveTrash"]),
  };
}

/**
 * Downloads the bytes of a file as text.
 *
 * @param simulation - The simulated Drive.
 * @param id - The file identifier.
 * @returns The downloaded content.
 */
export async function readText(
  simulation: GoogleDriveSimulation,
  id: string,
): Promise<string> {
  const answer = await callDrive(simulation, `/drive/v3/files/${id}`, {
    query: { alt: "media" },
  });

  return answer.response.text();
}

/**
 * Lists the names directly inside a folder.
 *
 * @param simulation - The simulated Drive.
 * @param parentId - The folder identifier.
 * @returns The names in answer order.
 */
export async function childNames(
  simulation: GoogleDriveSimulation,
  parentId: string,
): Promise<string[]> {
  return fileNames(
    await callDrive(simulation, "/drive/v3/files", {
      query: { q: `'${parentId}' in parents` },
    }),
  );
}
