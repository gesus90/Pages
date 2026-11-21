import {
  mcpDeviceMethodNotAllowed,
  mcpDeviceResponse,
} from "@/app/lib/mcp-device-response.server";
import { mcpOperationFailure } from "@/app/lib/mcp-milestone-route.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  McpSearchApi,
  readMcpSearchQuery,
} from "@/backend/service/mcp/search/McpSearchApi";

import type { Route } from "./+types/api-mcp-v1-search";

/** Creates the API over `search.sources` of the `mcp` channel and the device token check. */
async function createApi(): Promise<McpSearchApi> {
  const services = await getApplicationServices();
  return new McpSearchApi(services.mcpSearchServices, {
    devices: services.mcpDeviceService,
    accounts: services.userService,
  });
}

/**
 * Runs one search request.
 * @remarks
 * Only the bearer token admits a request, checked and noted by the device
 * API exactly as for the ticket and milestone APIs; browser cookies play no
 * part. The query is read after the token check, so an unpaired caller
 * learns nothing about its parameters.
 */
async function runSearch(request: Request): Promise<Response> {
  if (request.method.toUpperCase() !== "GET")
    return mcpDeviceMethodNotAllowed("GET");
  try {
    const api = await createApi();
    const identity = await api.authenticate(
      request.headers.get("Authorization"),
    );
    const parameters = readMcpSearchQuery(new URL(request.url).searchParams);
    return mcpDeviceResponse(await api.search(identity, parameters));
  } catch (error: unknown) {
    return mcpOperationFailure(error);
  }
}

/**
 * Searches tickets, wiki pages and released ticket assets together
 * (`GET /api/mcp/v1/search?question=…&projectId=…&sourceTypes=ticket,wiki_page&limit=10&cursor=…`).
 * @remarks
 * Answers the `result` of `search.sources`: at most `limit` (1 to 20,
 * default 10) sections, each with `sourceType`, `sourceId`, `title`, `link`
 * (the Pages address of the source), `text` and `matchedBy`, and
 * `nextCursor` for the next page of the same query. An empty or too long
 * question answers `INVALID_REQUEST`, a project the account cannot see
 * `NOT_FOUND`. Only the device token of a paired machine admits a request.
 */
export async function loader({ request }: Route.LoaderArgs): Promise<Response> {
  return runSearch(request);
}

/** Answers the changing methods of the same resource with `405`. */
export async function action({ request }: Route.ActionArgs): Promise<Response> {
  return runSearch(request);
}
