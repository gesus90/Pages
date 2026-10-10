import { describe, expect, it, vi } from "vitest";

import { readAgentJson } from "@/app/lib/agent-json.server";

interface StreamingRequestInit extends RequestInit {
  readonly duplex: "half";
}

function streamRequest(stream: ReadableStream): Request {
  const options: StreamingRequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  };
  return new Request("http://127.0.0.1/", options);
}

function request(body: string | null, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1/api/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("bounded agent JSON", () => {
  it("accepts exactly 65536 bytes including a split multibyte character", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ text: "ä" }) + " ".repeat(65536 - 13),
    );
    expect(bytes.byteLength).toBe(65536);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10));
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    const input = streamRequest(stream);
    expect(await readAgentJson(input)).toEqual({ text: "ä" });
  });

  it.each([null, "not JSON", "[]", "null", "1"])(
    "rejects non-object JSON or absent bodies (%s)",
    async (body) => {
      await expect(readAgentJson(request(body))).rejects.toMatchObject({
        code: "INVALID_REQUEST",
      });
    },
  );

  it("rejects the wrong content type without consuming the body", async () => {
    const input = request("{}", { "Content-Type": "text/plain" });
    await expect(readAgentJson(input)).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(input.bodyUsed).toBe(false);
  });

  it("rejects declared oversized bodies without reading or parsing", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const input = request("not JSON", { "Content-Length": "65537" });
    await expect(readAgentJson(input)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
    expect(input.bodyUsed).toBe(false);
    expect(parse).not.toHaveBeenCalled();
  });

  it("counts actual bytes even without or with a false content length, cancelling before parsing", async () => {
    const headerCases: Record<string, string>[] = [
      {},
      { "Content-Length": "1" },
    ];
    for (const headers of headerCases) {
      const parse = vi.spyOn(JSON, "parse");
      const input = request("ä".repeat(32769), headers);
      await expect(readAgentJson(input)).rejects.toMatchObject({
        code: "PAYLOAD_TOO_LARGE",
        status: 413,
      });
      expect(parse).not.toHaveBeenCalled();
      parse.mockRestore();
    }
  });

  it("rejects malformed UTF-8 and releases the reader on a broken stream", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
        controller.close();
      },
    });
    await expect(readAgentJson(streamRequest(stream))).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error("stream unavailable"));
      },
    });
    await expect(readAgentJson(streamRequest(broken))).rejects.toThrow(
      "stream unavailable",
    );
    expect(broken.locked).toBe(false);
  });
});
