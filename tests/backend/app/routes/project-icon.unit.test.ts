import { beforeEach, expect, it, vi } from "vitest";

import { action, loader } from "@/app/routes/project-icon";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/error/ProjectErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const MAXIMUM_ICON_SIZE = 2 * 1024 * 1024;
const ICON_URL = "http://pages.invalid/projekte/p%201/icon";

const fakes = vi.hoisted(() => ({ getIcon: vi.fn(), replaceIcon: vi.fn() }));
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    projectService: {
      getIcon: fakes.getIcon,
      replaceIcon: fakes.replaceIcon,
    },
  }),
}));

interface IconCall {
  readonly user?: User | null;
  readonly projectId?: string;
  readonly method?: string;
}

function load(options: IconCall = {}): Promise<Response> {
  return loader(
    routeArguments(
      new Request(ICON_URL, { method: options.method ?? "GET" }),
      options.user === undefined ? EMPLOYEE : options.user,
      { projectId: options.projectId ?? "p 1" },
    ),
  );
}

function upload(
  icon: File | string | null,
  options: IconCall = {},
): Promise<Response> {
  const form = new FormData();
  if (icon !== null) form.append("icon", icon);
  return action(
    routeArguments(
      new Request(ICON_URL, {
        method: options.method ?? "POST",
        body: options.method === undefined ? form : null,
      }),
      options.user === undefined ? EMPLOYEE : options.user,
      { projectId: options.projectId ?? "p 1" },
    ),
  );
}

function png(size = 4): File {
  return new File([new Uint8Array(size)], "icon.png", { type: "image/png" });
}

beforeEach(() => {
  fakes.replaceIcon.mockResolvedValue(undefined);
});

it("serves a visible project icon privately", async () => {
  fakes.getIcon.mockResolvedValue({
    data: Buffer.from([9, 8]),
    mimeType: "image/webp",
  });
  const response = await load();
  expect(fakes.getIcon).toHaveBeenCalledWith(EMPLOYEE, "p 1");
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 8]);
});

it("allows only GET for the icon", async () => {
  const response = await thrownResponse(load({ method: "HEAD" }));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("GET");
});

it.each<[string, IconCall, unknown, number]>([
  ["no session", { user: null }, null, 403],
  ["no project id", { projectId: "" }, null, 404],
  ["no stored icon", {}, null, 404],
  ["a missing project", {}, new ProjectNotFoundError(), 404],
  ["a hidden project", {}, new ProjectAccessDeniedError(), 403],
])(
  "answers %s with the right status",
  async (scenario, options, error, status) => {
    if (error === null) fakes.getIcon.mockResolvedValue(null);
    else fakes.getIcon.mockRejectedValue(error);
    expect((await thrownResponse(load(options))).status).toBe(status);
  },
);

it("rethrows an unexpected failure while reading the icon", async () => {
  const failure = new Error("database");
  fakes.getIcon.mockRejectedValue(failure);
  await expect(load()).rejects.toBe(failure);
});

it("replaces the icon and redirects to the project", async () => {
  const response = await upload(png());
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/projekte/p%201");
  expect(fakes.replaceIcon).toHaveBeenCalledWith(EMPLOYEE, "p 1", {
    data: Buffer.alloc(4),
    filename: "icon.png",
    mimeType: "image/png",
  });
});

it("names an icon without file name after its purpose", async () => {
  const boundary = "synthetic-boundary";
  // A browser may send an empty file name; FormData serialization cannot express it.
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="icon"; filename=""',
    "Content-Type: image/png",
    "",
    "abcd",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  await action(
    routeArguments(
      new Request(ICON_URL, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }),
      EMPLOYEE,
      { projectId: "p 1" },
    ),
  );
  expect(fakes.replaceIcon.mock.calls[0]?.[2]).toEqual({
    data: Buffer.from("abcd"),
    filename: "project-icon",
    mimeType: "image/png",
  });
});

it.each<[string, File | string | null]>([
  ["no file", null],
  ["a text field", "icon"],
  [
    "an unsupported type",
    new File(["<svg/>"], "i.svg", { type: "image/svg+xml" }),
  ],
  ["an empty file", png(0)],
  ["an oversized file", png(MAXIMUM_ICON_SIZE + 1)],
])("refuses %s with 400", async (scenario, icon) => {
  expect((await thrownResponse(upload(icon))).status).toBe(400);
  expect(fakes.replaceIcon).not.toHaveBeenCalled();
});

it("allows only POST for replacing", async () => {
  const response = await thrownResponse(upload(null, { method: "PUT" }));
  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a replacement without project id or session", async () => {
  expect((await thrownResponse(upload(png(), { projectId: "" }))).status).toBe(
    404,
  );
  expect((await thrownResponse(upload(png(), { user: null }))).status).toBe(
    403,
  );
  expect(fakes.replaceIcon).not.toHaveBeenCalled();
});

it.each<[string, Error, number]>([
  ["a missing project", new ProjectNotFoundError(), 404],
  ["a hidden project", new ProjectAccessDeniedError(), 403],
  ["missing management rights", new ProjectManagementDeniedError(), 403],
])("maps %s during replacement", async (scenario, error, status) => {
  fakes.replaceIcon.mockRejectedValue(error);
  expect((await thrownResponse(upload(png()))).status).toBe(status);
});

it("rethrows an unexpected failure while replacing", async () => {
  const failure = new Error("disk");
  fakes.replaceIcon.mockRejectedValue(failure);
  await expect(upload(png())).rejects.toBe(failure);
});
