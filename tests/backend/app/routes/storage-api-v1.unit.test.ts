import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/storage-api-v1";

import { EMPLOYEE } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

const files = vi.hoisted(() => ({
  isSimulation: true,
  capabilities: vi.fn(),
  reader: {
    list: vi.fn(),
    search: vi.fn(),
    read: vi.fn(),
    download: vi.fn(),
    stat: vi.fn(),
    quota: vi.fn(),
    resolvePath: vi.fn(),
  },
  writer: {
    confirm: vi.fn(),
    createFolder: vi.fn(),
    upload: vi.fn(),
    update: vi.fn(),
    trash: vi.fn(),
  },
}));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    googleDriveFileService: { forAccount: () => files },
  }),
}));
beforeEach(() => vi.resetAllMocks());

function get(operation: string, query = ""): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/storage${query}`),
      EMPLOYEE,
      { operation },
    ),
  );
}
function post(operation: string, body: unknown): Promise<Response> {
  return action(
    routeArguments(
      new Request("http://pages.invalid/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      EMPLOYEE,
      { operation },
    ),
  );
}

it("validates operations and methods before invoking services", async () => {
  expect((await get("unknown")).status).toBe(400);
  const wrongRead = await get("delete");
  expect(wrongRead.status).toBe(405);
  expect(wrongRead.headers.get("Allow")).toBe("POST");
  const wrongWrite = await post("list", {});
  expect(wrongWrite.status).toBe(405);
  expect(wrongWrite.headers.get("Allow")).toBe("GET");
  const forbidden = await loader(
    routeArguments(new Request("http://pages.invalid/storage"), null, {
      operation: "list",
    }),
  );
  expect(forbidden.status).toBe(403);
});

it("passes normalized listing and search parameters to the account reader", async () => {
  files.reader.list.mockResolvedValue({ ok: true, value: ["item"] });
  files.reader.search.mockResolvedValue({ ok: true, value: [] });
  const response = await get("list", "?trash=1&pageSize=25&pageToken=next");
  expect(files.reader.list).toHaveBeenCalledWith({
    isTrash: true,
    pageSize: 25,
    pageToken: "next",
    ref: "root",
  });
  expect(await response.json()).toEqual({
    ok: true,
    result: ["item"],
    simulation: true,
  });
  await get("search", "?query=hello&folder=folder&pageSize=bad");
  expect(files.reader.search).toHaveBeenCalledWith({
    text: "hello",
    folderRef: "folder",
    pageSize: null,
    pageToken: null,
  });
});

it("validates confirmation and forwards folder creation", async () => {
  expect((await post("confirm", { action: "rename", ref: "a" })).status).toBe(
    400,
  );
  expect(files.writer.confirm).not.toHaveBeenCalled();
  files.writer.confirm.mockResolvedValue({ ok: true, value: "token" });
  expect((await post("confirm", { action: "delete", ref: "a" })).status).toBe(
    200,
  );
  expect(files.writer.confirm).toHaveBeenCalledWith({
    action: "delete",
    ref: "a",
    userId: EMPLOYEE.id,
  });
  files.writer.createFolder.mockResolvedValue({ ok: true, value: "folder" });
  await post("create_folder", { name: " Reports ", onConflict: "keep_both" });
  expect(files.writer.createFolder).toHaveBeenCalledWith({
    name: "Reports",
    parentRef: "root",
    onConflict: "keep_both",
    userId: EMPLOYEE.id,
  });
});

it("rejects missing upload files and reports service failures", async () => {
  expect((await post("upload", {})).status).toBe(400);
  expect(files.writer.upload).not.toHaveBeenCalled();
  files.reader.stat.mockRejectedValue(new Error("failure"));
  const response = await get("stat", "?ref=a");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    ok: false,
    error: { code: "failed" },
    simulation: true,
  });
});
