import { rm, readdir } from "node:fs/promises";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));

import { getApplicationServices } from "@/app/lib/services.server";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { readAgentAssetUpload } from "@/app/lib/agent-asset-upload.server";
import { action, loader } from "@/app/routes/api-v1-agent-assets";
import { loader as download } from "@/app/routes/agent-asset";
import { action as agentAction } from "@/app/routes/api-v1-agents";
import { AgentOperationError } from "@/backend/error/AgentOperationError";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { WikiPageNotFoundError } from "@/backend/error/WikiErrors";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";
import { useMigratedDatabase } from "../helpers/test-database";
import {
  agentWriteFixture,
  createInput,
  PNG,
  PDF,
} from "../helpers/agent-writes";

import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

function args(request: Request): Parameters<typeof action>[0] {
  return {
    request,
    context: new RouterContextProvider(),
    params: {},
    url: new URL(request.url),
    pattern: "/api/v1/agent-assets",
  };
}

function downloadArgs(
  assetId: string,
  actor?: User,
  suffix = "",
): Parameters<typeof download>[0] {
  const context = new RouterContextProvider();
  if (actor) context.set(authenticatedUserContext, actor);
  const request = new Request(
    `https://pages.invalid/agent-assets/${assetId}${suffix}`,
  );
  return {
    request,
    context,
    params: { assetId },
    url: new URL(request.url),
    pattern: "/agent-assets/:assetId",
  };
}

describe("A9.6 raw upload and stable authenticated download routes", () => {
  const getDatabase = useMigratedDatabase();
  const directories: string[] = [];
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(async () => {
    for (const directory of directories.splice(0))
      await rm(directory, { recursive: true, force: true });
  });
  async function fixture() {
    const run = await agentWriteFixture(getDatabase());
    directories.push(run.filesDirectory);
    vi.mocked(getApplicationServices).mockResolvedValue({
      agentUploadTicketService: run.tickets,
      agentAssetService: run.assets,
      pagesAgentApiService: run.api,
    } as unknown as ApplicationServices);
    return run;
  }

  it("uploads PNG larger than the JSON limit and PDF via one-use headers, then resolves bytes before and after linking", async () => {
    const run = await fixture();
    const assetIds: string[] = [];
    for (const [fileName, content] of [
      ["image.png", Buffer.concat([PNG, Buffer.alloc(70_000)])],
      ["paper.pdf", PDF],
    ] as const) {
      const ticket = run.tickets.issue(run.token, "owner", fileName);
      const response = await action(
        args(
          new Request("https://pages.invalid/api/v1/agent-assets", {
            method: "POST",
            headers: {
              "X-Pages-Upload-Ticket": ticket.ticket,
              "Content-Type": "application/octet-stream",
            },
            body: content,
          }),
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const result = await response.json();
      expect(result).toMatchObject({
        apiVersion: "1",
        result: {
          assetId: expect.any(String),
          link: expect.stringMatching(/^\/agent-assets\//),
          size: content.length,
        },
      });
      assetIds.push(result.result.assetId);
      const opened = await download(
        downloadArgs(result.result.assetId, run.owner),
      );
      expect(Buffer.from(await opened.arrayBuffer())).toEqual(content);
      expect(opened.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(opened.headers.get("Content-Security-Policy")).toContain(
        "sandbox",
      );
      expect(opened.headers.get("Content-Disposition")).toMatch(
        fileName === "image.png" ? /^inline/ : /^attachment/,
      );
      const replay = await action(
        args(
          new Request("https://pages.invalid/api/v1/agent-assets", {
            method: "POST",
            headers: { "X-Pages-Upload-Ticket": ticket.ticket },
            body: PNG,
          }),
        ),
      );
      expect(replay.status).toBe(401);
    }
    const created = await run.create.create(
      run.owner,
      createInput({ assetIds }),
    );
    expect(created.assets).toHaveLength(2);
    const forced = await download(
      downloadArgs(assetIds[0] ?? "", run.other, "?download=1"),
    );
    expect(forced.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect((await forced.arrayBuffer()).byteLength).toBe(70_000 + PNG.length);
    const linked = await download(downloadArgs(assetIds[1] ?? "", run.other));
    expect(Buffer.from(await linked.arrayBuffer())).toEqual(PDF);
  });

  it("never serves SVG or HTML inline even under a raster filename and declared content type", async () => {
    const run = await fixture();
    for (const content of [
      "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
      "<html><script>alert(1)</script></html>",
    ]) {
      const response = await action(
        args(
          new Request("https://pages.invalid/api/v1/agent-assets", {
            method: "POST",
            headers: {
              "X-Pages-Upload-Ticket": run.tickets.issue(
                run.token,
                "owner",
                "image.png",
              ).ticket,
              "Content-Type": "image/png",
            },
            body: content,
          }),
        ),
      );
      const uploaded = await response.json();
      const opened = await download(
        downloadArgs(uploaded.result.assetId, run.owner),
      );
      expect(opened.headers.get("Content-Type")).toBe(
        "application/octet-stream",
      );
      expect(opened.headers.get("Content-Disposition")).toMatch(/^attachment/);
      expect(opened.headers.get("Content-Security-Policy")).toContain(
        "sandbox",
      );
      expect(await opened.text()).toBe(content);
    }
  });

  it("rejects methods, OAuth/personal authorization, URL credentials and missing tickets before reading any bytes", async () => {
    for (const [method, headers, query, status] of [
      ["GET", {}, "", 405],
      ["POST", {}, "", 401],
      ["POST", { Authorization: "Bearer oauth" }, "", 401],
      [
        "POST",
        {
          Authorization: "Bearer oauth",
          "X-Pages-Upload-Ticket": "a".repeat(43),
        },
        "",
        401,
      ],
      ["POST", { "X-Pages-Upload-Ticket": "bad" }, "", 401],
      [
        "POST",
        { "X-Pages-Upload-Ticket": "a".repeat(43) },
        "?ticket=synthetic",
        400,
      ],
    ] as const) {
      const request = new Request(
        `https://pages.invalid/api/v1/agent-assets${query}`,
        { method, headers, ...(method === "POST" ? { body: "not JSON" } : {}) },
      );
      const response =
        method === "GET"
          ? await loader(args(request))
          : await action(args(request));
      expect(response.status).toBe(status);
      expect(request.bodyUsed).toBe(false);
      if (status === 401)
        expect(response.headers.get("WWW-Authenticate")).toBe(
          "Pages-Upload-Ticket",
        );
      if (status === 405) expect(response.headers.get("Allow")).toBe("POST");
    }
    expect(getApplicationServices).not.toHaveBeenCalled();
  });

  it("maps business and authentication failures and hides infrastructure diagnostics", async () => {
    const run = await fixture();
    const consume = vi.spyOn(run.tickets, "consume");
    for (const [error, status, code] of [
      [new AgentOperationError("PAYLOAD_TOO_LARGE"), 413, "PAYLOAD_TOO_LARGE"],
      [new McpAuthorizationError("invalid_token", 401), 401, "AUTH_INVALID"],
      [new Error("private diagnostic"), 503, "AUTH_UNAVAILABLE"],
    ] as const) {
      consume.mockRejectedValueOnce(error);
      const response = await action(
        args(
          new Request("https://pages.invalid/api/v1/agent-assets", {
            method: "POST",
            headers: { "X-Pages-Upload-Ticket": "a".repeat(43) },
            body: PNG,
          }),
        ),
      );
      expect(response.status).toBe(status);
      const text = await response.text();
      expect(text).toContain(code);
      expect(text).not.toContain("private diagnostic");
    }
  });

  it("cancels an oversized live stream and leaves no staging row or partial file", async () => {
    const run = await fixture();
    await run.repository.settings.save({
      ...WIKI_SETTING_DEFAULTS,
      mediaLimitBytes: 8192,
      fileLimitBytes: 8192,
    });
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(Buffer.concat([PNG, Buffer.alloc(5000)]));
      },
      cancel,
    });
    const options: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        "X-Pages-Upload-Ticket": run.tickets.issue(
          run.token,
          "owner",
          "image.png",
        ).ticket,
      },
      body: stream,
      duplex: "half",
    };
    const response = await action(
      args(new Request("https://pages.invalid/api/v1/agent-assets", options)),
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBeLessThan(5);
    expect(
      await run.database.query("SELECT COUNT(*) FROM agent_assets;"),
    ).toEqual([[0]]);
    expect(await readdir(path.join(run.filesDirectory, "staging"))).toEqual([]);
  });

  it("handles no body and invalid length without buffering", async () => {
    for (const length of ["-1", "invalid", "", "1.5"]) {
      const file = readAgentAssetUpload(
        new Request("https://pages.invalid/api/v1/agent-assets", {
          method: "POST",
          headers: { "Content-Length": length },
        }),
        "file",
      );
      expect(file.contentLength).toBeNull();
      const chunks = [];
      for await (const chunk of file.body) chunks.push(chunk);
      expect(chunks).toEqual([]);
    }
    const run = await fixture();
    const response = await action(
      args(
        new Request("https://pages.invalid/api/v1/agent-assets", {
          method: "POST",
          headers: {
            "X-Pages-Upload-Ticket": run.tickets.issue(
              run.token,
              "owner",
              "empty",
            ).ticket,
          },
        }),
      ),
    );
    expect(response.status).toBe(400);
    const file = readAgentAssetUpload(
      new Request("https://pages.invalid/api/v1/agent-assets", {
        method: "POST",
        headers: { "Content-Length": "8" },
        body: PNG,
      }),
      "image.png",
    );
    expect(file.contentLength).toBe(8);
    const chunks = [];
    for await (const chunk of file.body) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(PNG);
  });

  it("protects download identity and hidden/missing assets, and propagates file failures", async () => {
    const run = await fixture();
    await expect(download(downloadArgs("missing"))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      download(downloadArgs("missing", run.owner)),
    ).rejects.toMatchObject({ status: 404 });
    vi.spyOn(run.assets, "open").mockRejectedValueOnce(
      new Error("disk failure"),
    );
    await expect(download(downloadArgs("missing", run.owner))).rejects.toThrow(
      "disk failure",
    );
    vi.spyOn(run.assets, "open").mockRejectedValueOnce(
      new WikiPageNotFoundError(),
    );
    await expect(
      download(downloadArgs("missing", run.owner)),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("recovers create through the real API route and rejects changed input with CONFLICT", async () => {
    const run = await fixture();
    async function create(input: unknown) {
      const request = new Request("https://pages.invalid/api/v1/agents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${run.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          operation: "wiki.page.create",
          parameters: input,
        }),
      });
      return agentAction({ ...args(request), pattern: "/api/v1/agents" });
    }
    const first = await create(createInput());
    expect(first.status).toBe(200);
    await first.body?.cancel();
    const stored = await run.operationRepository.find(
      run.owner.id,
      createInput().operationId,
    );
    if (!stored)
      throw new Error("Expected committed operation after response loss.");
    expect(await (await create(createInput())).json()).toEqual({
      apiVersion: "1",
      result: JSON.parse(stored.resultJson),
    });
    const conflict = await create(createInput({ title: "changed" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: { code: "CONFLICT" },
    });
    expect(
      await run.database.query("SELECT COUNT(*) FROM wiki_pages;"),
    ).toEqual([[1]]);
  });
});
