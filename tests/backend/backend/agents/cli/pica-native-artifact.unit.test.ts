import { createHash } from "node:crypto";

import { beforeEach, expect, it, vi } from "vitest";

import {
  requirePicaNativeArtifact,
  verifyPicaNativeArtifact,
} from "@/backend/agents/cli/PicaNativeArtifact";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  handles: new Map<number, string>(),
  next: 0,
  mode: 0o700,
}));

vi.mock("node:fs", () => ({
  constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
  realpathSync: (file: string) => file,
  lstatSync: (file: string) => ({
    isDirectory: () => !disk.files.has(file),
    uid: process.getuid?.(),
    mode: disk.mode,
    dev: 1,
    ino: 1,
    size: disk.files.get(file)?.length ?? 0,
    mtimeMs: 1,
    ctimeMs: 1,
  }),
  openSync: (file: string) => {
    if (!disk.files.has(file)) throw new Error("missing");
    const handle = ++disk.next;
    disk.handles.set(handle, file);
    return handle;
  },
  closeSync: (handle: number) => {
    disk.handles.delete(handle);
  },
  fstatSync: (handle: number) => ({
    isFile: () => true,
    uid: process.getuid?.(),
    mode: disk.mode,
    size: Buffer.byteLength(
      disk.files.get(disk.handles.get(handle) ?? "") ?? "",
    ),
  }),
  readSync: (
    handle: number,
    buffer: Buffer,
    offset: number,
    ...readOptions: [number, number | null]
  ) => {
    const [length, position] = readOptions;
    const file = disk.handles.get(handle) ?? "";
    const content = Buffer.from(disk.files.get(file) ?? "");
    if (position === null && disk.handles.get(-handle) === "read") return 0;
    if (position === null) disk.handles.set(-handle, "read");
    return content.copy(buffer, offset, 0, length);
  },
  readdirSync: () =>
    ["manifest.json", "codex", "LICENSE"].map((name) => ({
      name,
      isDirectory: () => false,
      isFile: () => true,
    })),
}));

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "built-unverified",
    runner: "codex",
    expectedVersion: "0.160.0",
    lockSha256:
      "5553f06583159ed64666b6eb4beea3154e06b612e6312528131bdc226a6a860c",
    upstream: {
      version: "0.160.0",
      commit: "a956835d020762cb2b570053af06f643a11c0ecc",
    },
    target: { os: "linux", abi: "glibc" },
    capabilities: ["pica-tool-policy-candidate"],
    patches: [
      {
        path: "backend/agents/codex-patch/pages-tool-policy.patch",
        sha256:
          "ae87b482ce96ae23b2b89499bb285de870bd90888d964e8db4a53489a398a588",
      },
    ],
    files: {
      codex: { bytes: 3, sha256: digest("bin"), mode: "0700" },
      LICENSE: { bytes: 7, sha256: digest("license"), mode: "0700" },
    },
  };
}

beforeEach(() => {
  disk.files.clear();
  disk.handles.clear();
  disk.mode = 0o700;
  disk.files.set("/artifact/codex", "bin");
  disk.files.set("/artifact/LICENSE", "license");
  disk.files.set("/artifact/manifest.json", JSON.stringify(manifest()));
});

it("verifies a pinned artifact and its file hashes", () => {
  expect(verifyPicaNativeArtifact("/artifact", "codex")).toEqual({
    runner: "codex",
    directory: "/artifact",
    executable: "/artifact/codex",
  });
});

it.each([
  ["wrong version", { expectedVersion: "old" }],
  ["wrong patch", { patches: [] }],
  ["invalid file declaration", { files: { codex: {}, LICENSE: {} } }],
  ["wrong runner", { runner: "opencode" }],
])("refuses %s", (label, change) => {
  expect(label).toBeTruthy();
  disk.files.set(
    "/artifact/manifest.json",
    JSON.stringify({ ...manifest(), ...change }),
  );
  expect(() => verifyPicaNativeArtifact("/artifact", "codex")).toThrow(
    "Pica needs the verified native Pages build",
  );
});

it("refuses a changed file, unsafe permissions, and a missing tools folder", () => {
  disk.files.set("/artifact/codex", "bad");
  disk.files.set(
    "/artifact/manifest.json",
    JSON.stringify({ ...manifest(), extra: "changed" }),
  );
  expect(() => verifyPicaNativeArtifact("/artifact", "codex")).toThrow(
    "Pica needs the verified native Pages build",
  );
  disk.mode = 0o722;
  expect(() => verifyPicaNativeArtifact("/artifact", "codex")).toThrow(
    "Pica needs the verified native Pages build",
  );
  expect(() => requirePicaNativeArtifact(undefined, "codex")).toThrow(
    "Pica needs the verified native Pages build",
  );
});
