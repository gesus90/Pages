import { readFile } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { logFileProbeError } from "@/backend/logging/Logger";

import {
  APP_DOCUMENT_FILE,
  requestTargetPath,
  serveAppDocument,
} from "./AppDocument";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("@/backend/logging/Logger", () => ({ logFileProbeError: vi.fn() }));

const CLIENT_DIRECTORY = "/srv/pages/client";
const DOCUMENT = Buffer.from("<!doctype html><title>Pages</title>");

let response: ServerResponse;

beforeEach(() => {
  response = new ServerResponse(new IncomingMessage(new Socket()));
  vi.spyOn(response, "writeHead").mockReturnValue(response);
  vi.spyOn(response, "end").mockReturnValue(response);
});

it("reads the path of an origin-form target without its query", () => {
  expect(requestTargetPath("/pair?code=abc")).toBe("/pair");
});

it("keeps the encoding of the path", () => {
  expect(requestTargetPath("/wiki/a%20b")).toBe("/wiki/a%20b");
});

it("keeps a double leading slash as part of the path", () => {
  expect(requestTargetPath("//pair")).toBe("//pair");
});

it("answers a missing target with the root path", () => {
  expect(requestTargetPath(undefined)).toBe("/");
});

it("reads the path of an absolute-form target", () => {
  expect(requestTargetPath("http://example.test/a/b?x=1")).toBe("/a/b");
});

it("serves the document with security headers and its length", async () => {
  vi.mocked(readFile).mockResolvedValue(DOCUMENT);

  const isServed = await serveAppDocument(
    { method: "GET", pathname: "/wiki" },
    response,
    CLIENT_DIRECTORY,
  );

  expect(isServed).toBe(true);
  expect(readFile).toHaveBeenCalledWith(
    path.join(CLIENT_DIRECTORY, APP_DOCUMENT_FILE),
  );
  expect(response.writeHead).toHaveBeenCalledWith(
    200,
    expect.objectContaining({
      "Cache-Control": "no-cache",
      "Content-Length": DOCUMENT.length,
      "Content-Type": "text/html; charset=utf-8",
    }),
  );
  expect(response.end).toHaveBeenCalledWith(DOCUMENT);
});

it("never stores a sensitive page address", async () => {
  vi.mocked(readFile).mockResolvedValue(DOCUMENT);

  await serveAppDocument(
    { method: "GET", pathname: "/discord/result" },
    response,
    CLIENT_DIRECTORY,
  );

  expect(response.writeHead).toHaveBeenCalledWith(
    200,
    expect.objectContaining({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
  );
});

it("sends the headers but no body for a HEAD request", async () => {
  vi.mocked(readFile).mockResolvedValue(DOCUMENT);

  const isServed = await serveAppDocument(
    { method: "HEAD", pathname: "/wiki" },
    response,
    CLIENT_DIRECTORY,
  );

  expect(isServed).toBe(true);
  expect(response.writeHead).toHaveBeenCalledWith(
    200,
    expect.objectContaining({ "Content-Length": DOCUMENT.length }),
  );
  expect(response.end).toHaveBeenCalledWith(undefined);
});

it("writes nothing and reports the failure when the document is missing", async () => {
  const failure = new Error("ENOENT");
  vi.mocked(readFile).mockRejectedValue(failure);

  const isServed = await serveAppDocument(
    { method: "GET", pathname: "/wiki" },
    response,
    CLIENT_DIRECTORY,
  );

  expect(isServed).toBe(false);
  expect(logFileProbeError).toHaveBeenCalledWith("AppDocument", failure);
  expect(response.writeHead).not.toHaveBeenCalled();
  expect(response.end).not.toHaveBeenCalled();
});
