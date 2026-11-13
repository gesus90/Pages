import {
  mcpDeviceFailure,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { readMcpStorageBody } from "@/app/lib/mcp-storage-body.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  storageDownloadResponse,
  storageErrorResponse,
} from "@/app/lib/storage-api.server";
import { readMcpStorageInput } from "@/backend/service/mcp/storage/McpStorageRequest";
import { McpStorageService } from "@/backend/service/mcp/storage/McpStorageService";
import { toMcpUserError } from "@/backend/service/mcp/users/McpUserError";
import {
  STORAGE_OPERATIONS,
  STORAGE_READ_OPERATIONS,
} from "@/definition/GoogleDriveFiles";

import type {
  StorageError,
  StorageOperation,
} from "@/definition/GoogleDriveFiles";
import type { McpStorageBody } from "./mcp-storage-body.server";

const OPERATION_ALIASES: Readonly<Record<string, StorageOperation>> = {
  "resolve-path": "resolve_path",
  "create-folder": "create_folder",
  "delete-permanently": "delete_permanently",
  trash: "delete",
};

function operationFrom(path: string): StorageOperation | null {
  const alias = Object.hasOwn(OPERATION_ALIASES, path)
    ? OPERATION_ALIASES[path]
    : undefined;
  if (alias !== undefined) return alias;
  return (
    STORAGE_OPERATIONS.find(
      (operation) => operation === path && operation !== "batch",
    ) ?? null
  );
}

function answer(
  body: object,
  simulation: boolean,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return mcpDeviceResponse({ ...body, simulation }, status, {
    ...headers,
    ...(simulation ? { "X-Pages-Storage-Simulation": "1" } : {}),
  });
}

function failure(error: StorageError, simulation: boolean): Response {
  const { code, ...details } = error;
  return answer(
    { error: code, ...details },
    simulation,
    storageErrorResponse(error, simulation).status,
  );
}

async function parameters(
  request: Request,
  operation: StorageOperation,
  simulation: boolean,
): Promise<McpStorageBody | Response> {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (STORAGE_READ_OPERATIONS.includes(operation))
    return { metadata: query, bytes: null };
  const body = await readMcpStorageBody(
    request,
    operation === "upload" || operation === "update",
  );
  if (!body.ok) return failure(body.error, simulation);
  return { ...body.value, metadata: { ...query, ...body.value.metadata } };
}

/**
 * Serves the authenticated Storage MCP namespace, including JSON failures for unknown paths.
 *
 * @param request - Bearer-authenticated request; cookies do not grant access.
 * @param path - Operation below `/api/mcp/v1/storage`.
 * @returns Direct MCP JSON or an attachment stream; no SPA document fallback.
 */
export async function runMcpStorageRoute(
  request: Request,
  path: string,
): Promise<Response> {
  try {
    const services = await getApplicationServices();
    const actor = await services.mcpUserApi.authenticate(
      request.headers.get("Authorization"),
    );
    const files = services.googleDriveFileService.forAccount(actor.id);
    const simulation = files.isSimulation;
    const operation = operationFrom(path);
    if (operation === null)
      return answer({ error: "not_found" }, simulation, 404);
    const method = STORAGE_READ_OPERATIONS.includes(operation) ? "GET" : "POST";
    if (
      request.method !== method &&
      !(method === "GET" && request.method === "HEAD")
    ) {
      return answer({ error: "invalid_request" }, simulation, 405, {
        Allow: method,
      });
    }
    const body = await parameters(request, operation, simulation);
    if (body instanceof Response) return body;
    const input = readMcpStorageInput(body.metadata);
    if (input === null) return failure({ code: "invalid_request" }, simulation);
    const api = new McpStorageService(files);
    if (operation === "download") {
      const download = await api.download(input);
      return download.ok
        ? storageDownloadResponse(download.value, simulation)
        : failure(download.error, simulation);
    }
    const result = await api.run(operation, {
      input,
      userId: actor.id,
      bytes: body.bytes,
    });
    return result.ok
      ? answer(result.value, simulation)
      : failure(result.error, simulation);
  } catch (error: unknown) {
    const rejected = toMcpUserError(error);
    return rejected === null
      ? mcpDeviceFailure(error)
      : mcpDeviceResponse(rejected.toBody(), rejected.status);
  }
}
