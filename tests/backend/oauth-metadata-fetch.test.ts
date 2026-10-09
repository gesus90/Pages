import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

import {
  fetchOAuthMetadata,
  isPublicOAuthAddress,
} from "@/backend/security/OAuthMetadataFetch";

let incoming: EventEmitter & {
  statusCode: number;
  headers: Record<string, string>;
  resume: ReturnType<typeof vi.fn>;
};
let outgoing: EventEmitter & {
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  setTimeout: ReturnType<typeof vi.fn>;
};
let callback: (() => void) | undefined;
beforeEach(() => {
  vi.mocked(lookup).mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
  ] as never);
  incoming = Object.assign(new EventEmitter(), {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    resume: vi.fn(),
  });
  outgoing = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn((error: Error) => {
      outgoing.emit("error", error);
    }),
    setTimeout: vi.fn(),
  });
  callback = undefined;
  vi.mocked(request).mockImplementation((_url, options, onResponse) => {
    callback = () => onResponse?.(incoming as never);
    const pinnedLookup = options.lookup;
    if (pinnedLookup)
      pinnedLookup("client.invalid", {}, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
      });
    return outgoing as never;
  });
});

function invokeResponse(): void {
  callback?.();
}

async function pendingFetch(): Promise<Promise<unknown>[]> {
  callback = undefined;
  incoming.removeAllListeners();
  outgoing.removeAllListeners();
  incoming.statusCode = 200;
  incoming.headers = { "content-type": "application/json" };
  const pending = fetchOAuthMetadata("https://client.invalid/metadata.json");
  await vi.waitFor(() => expect(callback).toBeDefined());
  invokeResponse();
  return [pending];
}

describe("public CIMD fetching", () => {
  it("pins a validated address and parses only bounded JSON", async () => {
    const [pending] = await pendingFetch();
    incoming.emit(
      "data",
      Buffer.from('{"client_id":"https://client.invalid/metadata.json"}'),
    );
    incoming.emit("end");
    await expect(pending).resolves.toHaveProperty("client_id");
    expect(outgoing.end).toHaveBeenCalledOnce();
  });
  it.each([
    "http://client.invalid/metadata.json",
    "https://user:secret@client.invalid/metadata.json",
    "https://client.invalid/metadata.json#fragment",
    "https://client.invalid/metadata.json?query=1",
    "https://client.invalid/",
  ])("rejects unsafe metadata location %s", async (location) => {
    await expect(fetchOAuthMetadata(location)).rejects.toThrow(
      "Invalid client metadata location.",
    );
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects empty, private and mixed DNS results", async () => {
    for (const addresses of [
      [],
      [{ address: "127.0.0.1", family: 4 }],
      [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    ]) {
      vi.mocked(lookup).mockResolvedValue(addresses as never);
      await expect(
        fetchOAuthMetadata("https://client.invalid/metadata.json"),
      ).rejects.toThrow("Invalid client metadata location.");
    }
  });
  it("rejects redirects, non-JSON responses and transport errors", async () => {
    const pending = fetchOAuthMetadata("https://client.invalid/metadata.json");
    await vi.waitFor(() => expect(callback).toBeDefined());
    incoming.statusCode = 302;
    invokeResponse();
    await expect(pending).rejects.toThrow("Invalid client metadata response.");
    const nonJson = fetchOAuthMetadata("https://client.invalid/metadata.json");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    incoming.statusCode = 200;
    incoming.headers = {};
    invokeResponse();
    await expect(nonJson).rejects.toThrow("Invalid client metadata response.");
    const [failed] = await pendingFetch();
    incoming.emit("error", new Error("transport"));
    await expect(failed).rejects.toThrow("transport");
  });
  it("enforces the size/time budget and rejects invalid JSON", async () => {
    const [oversized] = await pendingFetch();
    incoming.emit("data", Buffer.alloc(65_537));
    await expect(oversized).rejects.toThrow("too large");
    const [timedOut] = await pendingFetch();
    const timeout = outgoing.setTimeout.mock.calls.at(-1)?.[1];
    if (typeof timeout !== "function") throw new Error("Missing timeout");
    timeout();
    await expect(timedOut).rejects.toThrow("timed out");
    const [invalidJson] = await pendingFetch();
    incoming.emit("data", Buffer.from("{"));
    incoming.emit("end");
    await expect(invalidJson).rejects.toThrow(
      "Invalid client metadata response.",
    );
  });
  it("allows public addresses and blocks private, mapped and reserved addresses", () => {
    for (const address of ["93.184.216.34", "2606:4700:4700::1111"])
      expect(isPublicOAuthAddress(address)).toBe(true);
    for (const address of [
      "bad",
      "127.0.0.1",
      "10.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "2001:db8::1",
      "2001::1",
      "2002::1",
      "192.168.1.1",
      "169.254.169.254",
      "224.0.0.1",
    ])
      expect(isPublicOAuthAddress(address)).toBe(false);
  });
});
