import { Readable } from "node:stream";

import { expect, it, vi } from "vitest";

import { loader } from "@/app/routes/wiki-attachment";
import {
  WikiAccessDeniedError,
  WikiPageNotFoundError,
} from "@/backend/error/WikiErrors";

import { EMPLOYEE, thrownResponse } from "../server-lib/request-fixtures";
import { routeArguments } from "../server-lib/route-arguments";

import type { User } from "@/definition/User";

const open = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({
    wikiService: { openAttachment: open },
  }),
}));

function load(user: User | null, query = ""): Promise<Response> {
  return loader(
    routeArguments(
      new Request(`http://pages.invalid/wiki-api/attachments/a1${query}`),
      user,
      { attachmentId: "a1" },
    ),
  );
}

function attachment(isEmbeddable: boolean): void {
  open.mockResolvedValue({
    attachment: {
      fileName: "plan.png",
      size: 3,
      contentType: "image/png",
      isEmbeddable,
    },
    stream: Readable.from([Buffer.from("png")]),
  });
}

it("refuses visitors without a session", async () => {
  expect((await thrownResponse(load(null))).status).toBe(403);
  expect(open).not.toHaveBeenCalled();
});

it("shows an embeddable image inline with its own type", async () => {
  attachment(true);
  const response = await load(EMPLOYEE);
  expect(open).toHaveBeenCalledWith(EMPLOYEE, "a1");
  expect(response.headers.get("Content-Disposition")).toMatch(/^inline;/u);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Content-Length")).toBe("3");
  expect(response.headers.get("Content-Security-Policy")).toBe(
    "default-src 'none'; img-src 'self'; sandbox",
  );
  expect(await response.text()).toBe("png");
});

it("downloads an embeddable image on request", async () => {
  attachment(true);
  const response = await load(EMPLOYEE, "?download=1");
  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/u);
  expect(response.headers.get("Content-Type")).toBe("image/png");
});

it("sends any other file only as a download", async () => {
  attachment(false);
  const response = await load(EMPLOYEE);
  expect(response.headers.get("Content-Disposition")).toMatch(/^attachment;/u);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
});

it("answers a missing file or a hidden page with 404", async () => {
  open.mockRejectedValue(new WikiPageNotFoundError());
  expect((await thrownResponse(load(EMPLOYEE))).status).toBe(404);
});

it.each([new WikiAccessDeniedError(), new Error("disk")])(
  "rethrows the failure %s",
  async (failure) => {
    open.mockRejectedValue(failure);
    await expect(load(EMPLOYEE)).rejects.toBe(failure);
  },
);
