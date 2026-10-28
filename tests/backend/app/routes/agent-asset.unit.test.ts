import { Readable } from "node:stream";

import { beforeEach, expect, it, vi } from "vitest";

import { loader } from "@/app/routes/agent-asset";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const services = vi.hoisted(() => ({ agentAssetService: { open: vi.fn() } }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => services,
}));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  vi.resetAllMocks();
});

function asset(contentType: string, fileName: string): object {
  return {
    contentType,
    fileName,
    size: PNG.length,
    stream: Readable.from([PNG]),
  };
}

async function open(address: string): Promise<Response> {
  return loader(
    routeArguments(new Request(address), EMPLOYEE, { assetId: "asset-1" }),
  );
}

it("shows an image inline with a locked-down policy", async () => {
  services.agentAssetService.open.mockResolvedValue(
    asset("image/png", "shot.png"),
  );

  const response = await open("http://pages.invalid/agent-assets/asset-1");

  expect(services.agentAssetService.open).toHaveBeenCalledWith(
    EMPLOYEE,
    "asset-1",
  );
  expect(response.status).toBe(200);
  expect(Object.fromEntries(response.headers)).toMatchObject({
    "cache-control": "private, no-cache",
    "content-disposition": `inline; filename="shot.png"; filename*=UTF-8''shot.png`,
    "content-length": "4",
    "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
    "content-type": "image/png",
    "x-content-type-options": "nosniff",
  });
  expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
});

it("downloads an image when the address asks for it", async () => {
  services.agentAssetService.open.mockResolvedValue(
    asset("image/png", "shot.png"),
  );

  const response = await open(
    "http://pages.invalid/agent-assets/asset-1?download=1",
  );

  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/u);
});

it("downloads a file that browsers must not render", async () => {
  services.agentAssetService.open.mockResolvedValue(
    asset("text/html", "page.html"),
  );

  const response = await open("http://pages.invalid/agent-assets/asset-1");

  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/u);
  expect(response.headers.get("Content-Type")).toBe("text/html");
});

it("refuses a request without a signed-in account", async () => {
  const response = await thrownResponse(
    loader(
      routeArguments(new Request("http://pages.invalid/a"), null, {
        assetId: "asset-1",
      }),
    ),
  );

  expect(response.status).toBe(403);
  expect(services.agentAssetService.open).not.toHaveBeenCalled();
});

it("answers an invisible or missing asset with 404", async () => {
  services.agentAssetService.open.mockRejectedValue(
    new WikiPageNotFoundError(),
  );

  const response = await thrownResponse(
    open("http://pages.invalid/agent-assets/asset-1"),
  );

  expect(response.status).toBe(404);
});

it("rethrows any other failure", async () => {
  const failure = new Error("storage offline");
  services.agentAssetService.open.mockRejectedValue(failure);

  await expect(open("http://pages.invalid/agent-assets/asset-1")).rejects.toBe(
    failure,
  );
});
