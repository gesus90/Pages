import { expect, it } from "vitest";

import {
  readSimulatedUpload,
  simulatedError,
  simulatedMedia,
} from "./GoogleDriveSimulationResponses";
import { createSimulationSeed } from "./GoogleDriveSimulationSeed";

import type { SimulatedFile } from "./GoogleDriveSimulationSeed";

function seedFile(id: string): SimulatedFile {
  const file = createSimulationSeed().files.find((entry) => entry.id === id);
  if (!file) throw new Error(`Missing simulated file ${id}`);
  return file;
}

it("generates Drive errors and exports without embedding markup", async () => {
  const error = simulatedError(403, "forbidden", "refused");
  expect(error.status).toBe(403);
  expect(await error.json()).toEqual({
    error: {
      code: 403,
      errors: [{ domain: "global", message: "refused", reason: "forbidden" }],
      message: "refused",
    },
  });
  const file = seedFile("sim-readme");
  file.content = Buffer.from("<one>&two");
  expect(await simulatedMedia(file, "text/plain").text()).toBe("<one>&two");
  expect(await simulatedMedia(file, "text/html").text()).toBe(
    "<html><body><pre> one  two</pre></body></html>",
  );
  expect(await simulatedMedia(file, "text/csv").text()).toBe("<one>&two");
  expect(await simulatedMedia(file, "image/svg+xml").text()).toContain(
    "<text>README.txt</text>",
  );
  expect(await simulatedMedia(file, "application/pdf").text()).toContain(
    "exported as application/pdf",
  );
  file.content = null;
  expect(await simulatedMedia(file, "text/plain").text()).toBe("");
});

it("streams generated content with the declared length", async () => {
  const file = seedFile("sim-large-video");
  file.virtualSize = 65537;
  const response = simulatedMedia(file, "video/mp4");
  expect(response.headers.get("content-length")).toBe("65537");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes).toHaveLength(65537);
  expect(bytes.every((byte) => byte === 0x53)).toBe(true);
});

it("reads raw and multipart uploads and rejects invalid bodies", async () => {
  const media = new URL("https://example.test/upload?uploadType=media");
  expect(
    await readSimulatedUpload(media, {
      body: "bytes",
      headers: { "Content-Type": "text/plain" },
    }),
  ).toEqual({
    content: Buffer.from("bytes"),
    contentType: "text/plain",
    metadata: {},
  });
  expect(await readSimulatedUpload(media, {})).toEqual({
    content: Buffer.alloc(0),
    contentType: "application/octet-stream",
    metadata: {},
  });
  const multipart = new URL("https://example.test/upload?uploadType=multipart");
  const body =
    '--boundary\r\nContent-Type: application/json\r\n\r\n{"name":"test"}\r\n--boundary\r\nContent-Type: text/plain\r\n\r\nhello\r\n--boundary--';
  expect(
    await readSimulatedUpload(multipart, {
      body,
      headers: { "Content-Type": "multipart/related; boundary=boundary" },
    }),
  ).toEqual({
    content: Buffer.from("hello"),
    contentType: "text/plain",
    metadata: { name: "test" },
  });
  expect(
    await readSimulatedUpload(multipart, {
      body,
      headers: { "Content-Type": "multipart/related" },
    }),
  ).toBeNull();
  expect(
    await readSimulatedUpload(multipart, {
      body: "invalid",
      headers: { "Content-Type": "multipart/related; boundary=boundary" },
    }),
  ).toBeNull();
  expect(
    await readSimulatedUpload(multipart, {
      body: body.replace('{"name":"test"}', "invalid"),
      headers: { "Content-Type": "multipart/related; boundary=boundary" },
    }),
  ).toBeNull();
  expect(
    await readSimulatedUpload(new URL("https://example.test/upload"), {}),
  ).toBeNull();
});

it("handles absent export content and malformed multipart sections", async () => {
  const file = seedFile("sim-readme");
  file.content = null;
  expect(await simulatedMedia(file, "text/csv").text()).toBe("");
  const url = new URL("https://example.test/upload?uploadType=multipart");
  const headers = { "Content-Type": "multipart/related; boundary=boundary" };
  const upload = (metadata: string, mediaHeaders: string): string =>
    `--boundary\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n--boundary\r\n${mediaHeaders}\r\n\r\nbytes\r\n--boundary--`;
  expect(
    await readSimulatedUpload(url, { headers, body: upload("[]", "") }),
  ).toBeNull();
  expect(
    await readSimulatedUpload(url, {
      headers,
      body: upload("{}", "X-Test: yes"),
    }),
  ).toEqual({
    content: Buffer.from("bytes"),
    contentType: "application/octet-stream",
    metadata: {},
  });
  expect(
    await readSimulatedUpload(url, {
      headers,
      body: "--boundary\r\ninvalid\r\n--boundary--",
    }),
  ).toBeNull();
});
