import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/api-v1-agent-assets";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";

import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({
  agentAssetDownloadService: { consume: vi.fn() },
  agentAssetService: { upload: vi.fn() },
  agentTicketUploadService: { upload: vi.fn(), uploadWiki: vi.fn() },
  agentUploadTicketService: { consume: vi.fn() },
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const ADDRESS = "https://pages.invalid/api/v1/agent-assets";
const TICKET = "A".repeat(42) + "_";
const revalidate = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
});

async function upload(
  headers: Readonly<Record<string, string>>,
  init: RequestInit = {},
  address = ADDRESS,
): Promise<Response> {
  return action(
    routeArguments(
      new Request(address, {
        body: "bytes",
        headers: { "Content-Length": "5", ...headers },
        method: "POST",
        ...init,
      }),
      null,
      {},
    ),
  );
}

async function download(
  headers: Readonly<Record<string, string>>,
  init: RequestInit = {},
  address = ADDRESS,
): Promise<Response> {
  return loader(
    routeArguments(new Request(address, { headers, ...init }), null, {}),
  );
}

async function errorCode(response: Response): Promise<unknown> {
  const body: unknown = await response.json();

  return typeof body === "object" && body !== null && "error" in body
    ? body.error
    : null;
}

function authority(fields: object): object {
  return { fileName: "shot.png", revalidate, request: null, ...fields };
}

it("stores an upload as an agent asset under its one-use ticket", async () => {
  services.agentUploadTicketService.consume.mockResolvedValue(authority({}));
  services.agentAssetService.upload.mockResolvedValue({ id: "asset-1" });

  const response = await upload({ "X-Pages-Upload-Ticket": TICKET });

  expect(services.agentUploadTicketService.consume).toHaveBeenCalledWith(
    TICKET,
  );
  expect(services.agentAssetService.upload).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "shot.png", contentLength: 5 }),
    revalidate,
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(await response.json()).toEqual({
    apiVersion: "1",
    result: { id: "asset-1" },
  });
});

it("attaches an upload to the wiki page of its ticket", async () => {
  const request = { kind: "wiki" };
  services.agentUploadTicketService.consume.mockResolvedValue(
    authority({ pageId: "page-1", request }),
  );
  services.agentTicketUploadService.uploadWiki.mockResolvedValue({ id: "w" });

  const response = await upload({ "X-Pages-Upload-Ticket": TICKET });

  expect(services.agentTicketUploadService.uploadWiki).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "shot.png" }),
    revalidate,
    "page-1",
    request,
  );
  expect(await response.json()).toMatchObject({ result: { id: "w" } });
});

it("attaches an upload to the ticket it names", async () => {
  services.agentUploadTicketService.consume.mockResolvedValue(
    authority({ pageId: "page-1", ticketId: "ticket-1" }),
  );
  services.agentTicketUploadService.upload.mockResolvedValue({ id: "t" });

  await upload({ "X-Pages-Upload-Ticket": TICKET });

  expect(services.agentTicketUploadService.upload).toHaveBeenCalledWith(
    expect.objectContaining({ fileName: "shot.png" }),
    revalidate,
    "ticket-1",
    null,
  );
  expect(services.agentTicketUploadService.uploadWiki).not.toHaveBeenCalled();
});

it("refuses an upload that is no POST", async () => {
  const response = await upload(
    { "X-Pages-Upload-Ticket": TICKET },
    { method: "PUT" },
  );

  expect(response.status).toBe(405);
  expect(await errorCode(response)).toMatchObject({
    code: "METHOD_NOT_ALLOWED",
  });
});

it("refuses an upload address with a query", async () => {
  const response = await upload(
    { "X-Pages-Upload-Ticket": TICKET },
    {},
    `${ADDRESS}?ticket=${TICKET}`,
  );

  expect(response.status).toBe(400);
  expect(await errorCode(response)).toMatchObject({ code: "INVALID_REQUEST" });
});

it.each([
  ["no ticket", {}],
  ["a malformed ticket", { "X-Pages-Upload-Ticket": "short" }],
  [
    "a bearer credential beside the ticket",
    { "X-Pages-Upload-Ticket": TICKET, Authorization: "Bearer x" },
  ],
])("asks for an upload ticket with %s", async (caseName, headers) => {
  const response = await upload(headers);

  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe("Pages-Upload-Ticket");
  expect(await errorCode(response)).toMatchObject({ code: "AUTH_REQUIRED" });
  expect(services.agentUploadTicketService.consume).not.toHaveBeenCalled();
});

it.each([
  [
    new AgentOperationError("PAYLOAD_TOO_LARGE"),
    413,
    "PAYLOAD_TOO_LARGE",
    null,
  ],
  [
    new McpAuthorizationError("invalid_token", 401),
    401,
    "AUTH_INVALID",
    "Pages-Upload-Ticket",
  ],
  [new Error("disk full"), 503, "AUTH_UNAVAILABLE", null],
])("maps an upload failure to %i", async (failure, status, code, challenge) => {
  services.agentUploadTicketService.consume.mockRejectedValue(failure);

  const response = await upload({ "X-Pages-Upload-Ticket": TICKET });

  expect(response.status).toBe(status);
  expect(response.headers.get("WWW-Authenticate")).toBe(challenge);
  expect(await errorCode(response)).toMatchObject({ code });
});

it("downloads an authorized original as an inert attachment", async () => {
  services.agentAssetDownloadService.consume.mockResolvedValue({
    bytes: Buffer.from("text"),
    size: 4,
    fileName: "notes.txt",
    original: { mimeType: "text/plain", digest: "sha256:abc" },
  });

  const response = await download({ "X-Pages-Download-Ticket": TICKET });

  expect(services.agentAssetDownloadService.consume).toHaveBeenCalledWith(
    TICKET,
  );
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
    "content-length": "4",
    "content-security-policy": "sandbox; default-src 'none'",
    "content-type": "text/plain",
    "x-content-type-options": "nosniff",
    "x-pages-asset-digest": "sha256:abc",
  });
  expect(await response.text()).toBe("text");
});

it("refuses a download that is no GET", async () => {
  const response = await download(
    { "X-Pages-Download-Ticket": TICKET },
    { method: "DELETE" },
  );

  expect(response.status).toBe(405);
});

it.each([
  ["a query", {}, `${ADDRESS}?x=1`],
  ["a bearer credential", { Authorization: "Bearer x" }, ADDRESS],
])("refuses a download with %s", async (caseName, headers, address) => {
  const response = await download(
    { "X-Pages-Download-Ticket": TICKET, ...headers },
    {},
    address,
  );

  expect(response.status).toBe(400);
  expect(services.agentAssetDownloadService.consume).not.toHaveBeenCalled();
});

it.each([
  ["no ticket", {}],
  ["a malformed ticket", { "X-Pages-Download-Ticket": "short" }],
])("asks for a download ticket with %s", async (caseName, headers) => {
  const response = await download(headers);

  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toBe("Pages-Upload-Ticket");
});

it.each([
  [new AgentOperationError("NOT_FOUND"), 404, "NOT_FOUND"],
  [new McpAuthorizationError("invalid_token", 401), 401, "AUTH_INVALID"],
  [new Error("disk full"), 503, "AUTH_UNAVAILABLE"],
])("maps a download failure to %i", async (failure, status, code) => {
  services.agentAssetDownloadService.consume.mockRejectedValue(failure);

  const response = await download({ "X-Pages-Download-Ticket": TICKET });

  expect(response.status).toBe(status);
  expect(await errorCode(response)).toMatchObject({ code });
});
