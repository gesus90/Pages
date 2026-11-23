import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  ftruncateSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";
import { AgentError } from "@/backend/error/AgentErrors";

const reads = vi.hoisted(() => ({ isShort: false }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof FsModule>();
  return {
    ...actual,
    readSync: (...parameters: Parameters<typeof actual.readSync>): number =>
      reads.isShort ? 0 : actual.readSync(...parameters),
  };
});

import {
  requirePicaNativeArtifact,
  verifyPicaNativeArtifact,
} from "./PicaNativeArtifact";

import type * as FsModule from "node:fs";
import type { PicaNativeRunner } from "./PicaNativeArtifact";

const CODEX_PIN = {
  version: "0.160.0",
  commit: "a956835d020762cb2b570053af06f643a11c0ecc",
  patchPath: "backend/agents/codex-patch/pages-tool-policy.patch",
  patchSha256:
    "ae87b482ce96ae23b2b89499bb285de870bd90888d964e8db4a53489a398a588",
  capability: "pica-tool-policy-candidate",
  lockSha256:
    "5553f06583159ed64666b6eb4beea3154e06b612e6312528131bdc226a6a860c",
};
const OPENCODE_PIN = {
  version: "1.18.34",
  commit: "aec0b9a6d8898f68f923aaf08b7306d931fd9d76",
  patchPath: "backend/agents/opencode-patch/pages-pica.patch",
  patchSha256:
    "aeb4124998396098f19fd3b5016e59cfe7d85e9acf7b2d655e43bfa612a16f3d",
  capability: "pica-native-tools-candidate",
  lockSha256:
    "04483150cfabd37bedae4055036cd7a665e3471053adad343cb1ccfbbca6c79c",
};
const UNAVAILABLE = new AgentError("pica_native_artifact_unavailable");

type Manifest = Record<string, unknown>;

let base = "";
let counter = 0;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pinOf(runner: PicaNativeRunner): typeof CODEX_PIN {
  return runner === "codex" ? CODEX_PIN : OPENCODE_PIN;
}

function manifestOf(runner: PicaNativeRunner): Manifest {
  const pin = pinOf(runner);
  return {
    schemaVersion: 1,
    status: "built-unverified",
    runner,
    expectedVersion: pin.version,
    lockSha256: pin.lockSha256,
    upstream: { version: pin.version, commit: pin.commit },
    target: { os: "linux", abi: "glibc" },
    capabilities: [pin.capability],
    patches: [{ path: pin.patchPath, sha256: pin.patchSha256 }],
    files: {
      [runner]: { bytes: 6, sha256: sha("binary"), mode: "0755" },
      LICENSE: { bytes: 7, sha256: sha("license"), mode: "0644" },
    },
  };
}

function writeManifest(directory: string, manifest: unknown): void {
  const file = path.join(directory, "manifest.json");
  writeFileSync(file, JSON.stringify(manifest));
  chmodSync(file, 0o644);
}

function build(
  runner: PicaNativeRunner = "codex",
  change: (manifest: Manifest) => void = () => undefined,
): string {
  counter += 1;
  const directory = path.join(base, `build-${counter}`);
  mkdirSync(directory, { mode: 0o755 });
  chmodSync(directory, 0o755);
  writeFileSync(path.join(directory, runner), "binary");
  chmodSync(path.join(directory, runner), 0o755);
  writeFileSync(path.join(directory, "LICENSE"), "license");
  chmodSync(path.join(directory, "LICENSE"), 0o644);
  const manifest = manifestOf(runner);
  change(manifest);
  writeManifest(directory, manifest);
  return directory;
}

function files(manifest: Manifest): Record<string, unknown> {
  return Object.assign({}, manifest.files);
}

beforeEach(() => {
  const parent = pagesTempDirectory("pica-native-artifact-tests");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  base = realpathSync(mkdtempSync(path.join(parent, "case-")));
});

afterEach(() => {
  reads.isShort = false;
  rmSync(base, { recursive: true, force: true });
});

it("accepts verified builds of both runners", () => {
  for (const runner of ["codex", "opencode"] as const) {
    const directory = build(runner);
    expect(verifyPicaNativeArtifact(directory, runner)).toEqual({
      runner,
      directory,
      executable: path.join(directory, runner),
      version: pinOf(runner).version,
    });
  }
});

it("selects the build below the tools folder", () => {
  const tools = path.join(base, "tools");
  mkdirSync(path.join(tools, "pica-native"), { recursive: true });
  const directory = path.join(tools, "pica-native", "codex");
  mkdirSync(directory, { mode: 0o755 });
  const built = build("codex");
  for (const name of ["codex", "LICENSE", "manifest.json"])
    writeFileSync(
      path.join(directory, name),
      readFileSync(path.join(built, name)),
    );
  chmodSync(path.join(directory, "codex"), 0o755);
  chmodSync(path.join(directory, "LICENSE"), 0o644);
  chmodSync(path.join(directory, "manifest.json"), 0o644);
  expect(requirePicaNativeArtifact(tools, "codex").directory).toBe(directory);
  expect(() => requirePicaNativeArtifact(undefined, "codex")).toThrow(
    UNAVAILABLE,
  );
  expect(() => requirePicaNativeArtifact(tools, "opencode")).toThrow(
    UNAVAILABLE,
  );
});

it("refuses missing, linked and unsafe directories", () => {
  expect(() =>
    verifyPicaNativeArtifact(path.join(base, "missing"), "codex"),
  ).toThrow(UNAVAILABLE);
  const directory = build();
  const link = path.join(base, "link");
  symlinkSync(directory, link);
  expect(() => verifyPicaNativeArtifact(link, "codex")).toThrow(UNAVAILABLE);
  const plain = path.join(base, "plain");
  writeFileSync(plain, "x");
  expect(() => verifyPicaNativeArtifact(plain, "codex")).toThrow(UNAVAILABLE);
  chmodSync(directory, 0o775);
  expect(() => verifyPicaNativeArtifact(directory, "codex")).toThrow(
    UNAVAILABLE,
  );
});

it("refuses unusable manifest files", () => {
  const unwritable = build();
  chmodSync(path.join(unwritable, "manifest.json"), 0o664);
  expect(() => verifyPicaNativeArtifact(unwritable, "codex")).toThrow(
    UNAVAILABLE,
  );
  const asDirectory = build();
  rmSync(path.join(asDirectory, "manifest.json"));
  mkdirSync(path.join(asDirectory, "manifest.json"));
  expect(() => verifyPicaNativeArtifact(asDirectory, "codex")).toThrow(
    UNAVAILABLE,
  );
  const tiny = build();
  writeFileSync(path.join(tiny, "manifest.json"), "{");
  expect(() => verifyPicaNativeArtifact(tiny, "codex")).toThrow(UNAVAILABLE);
  const huge = build();
  writeFileSync(path.join(huge, "manifest.json"), " ".repeat(1024 * 1024 + 1));
  expect(() => verifyPicaNativeArtifact(huge, "codex")).toThrow(UNAVAILABLE);
  for (const content of ["[]", "not json", "null"]) {
    const invalid = build();
    writeFileSync(path.join(invalid, "manifest.json"), content);
    chmodSync(path.join(invalid, "manifest.json"), 0o644);
    expect(() => verifyPicaNativeArtifact(invalid, "codex")).toThrow(
      UNAVAILABLE,
    );
  }
});

it("refuses a manifest that cannot be read completely", () => {
  const directory = build();
  reads.isShort = true;
  expect(() => verifyPicaNativeArtifact(directory, "codex")).toThrow(
    UNAVAILABLE,
  );
});

it("refuses a manifest of another identity or pin", () => {
  const changes: ((manifest: Manifest) => void)[] = [
    (manifest) => void (manifest.schemaVersion = 2),
    (manifest) => void (manifest.status = "verified"),
    (manifest) => void (manifest.runner = "opencode"),
    (manifest) => void (manifest.expectedVersion = "0.0.1"),
    (manifest) => void (manifest.lockSha256 = "x"),
    (manifest) => void (manifest.upstream = null),
    (manifest) => void (manifest.upstream = { ...CODEX_PIN, version: "1" }),
    (manifest) =>
      void (manifest.upstream = { version: CODEX_PIN.version, commit: "x" }),
    (manifest) => void (manifest.target = { os: "darwin", abi: "glibc" }),
    (manifest) => void (manifest.target = { os: "linux", abi: "musl" }),
    (manifest) => void (manifest.capabilities = "x"),
    (manifest) => void (manifest.capabilities = []),
    (manifest) => void (manifest.capabilities = ["other"]),
    (manifest) => void (manifest.patches = "x"),
    (manifest) => void (manifest.patches = []),
    (manifest) => void (manifest.patches = [{ path: "x", sha256: "y" }]),
    (manifest) =>
      void (manifest.patches = [{ path: CODEX_PIN.patchPath, sha256: "y" }]),
    (manifest) => void (manifest.patches = [manifestOf("codex").patches, 1, 2]),
  ];
  for (const change of changes)
    expect(() =>
      verifyPicaNativeArtifact(build("codex", change), "codex"),
    ).toThrow(UNAVAILABLE);
  const twoPatches = build("codex", (manifest) => {
    const [first] = Array.from(Object(manifest.patches));
    manifest.patches = [first, first];
  });
  expect(verifyPicaNativeArtifact(twoPatches, "codex").runner).toBe("codex");
  expect(() => verifyPicaNativeArtifact(build("opencode"), "codex")).toThrow(
    UNAVAILABLE,
  );
});

it("refuses malformed file declarations", () => {
  const valid = { bytes: 6, sha256: sha("binary"), mode: "0755" };
  const declarations: unknown[] = [
    null,
    { LICENSE: valid },
    { codex: valid },
    { codex: null, LICENSE: valid },
    { codex: { ...valid, bytes: "6" }, LICENSE: valid },
    { codex: { ...valid, bytes: 1.5 }, LICENSE: valid },
    { codex: { ...valid, sha256: 1 }, LICENSE: valid },
    { codex: { ...valid, sha256: "abc" }, LICENSE: valid },
    { codex: { ...valid, mode: 755 }, LICENSE: valid },
    { codex: { ...valid, mode: "755" }, LICENSE: valid },
    {
      codex: valid,
      LICENSE: valid,
      ...Object.fromEntries(
        Array.from({ length: 4097 }, (_, index) => [`f${index}`, valid]),
      ),
    },
  ];
  for (const declared of declarations)
    expect(() =>
      verifyPicaNativeArtifact(
        build("codex", (manifest) => void (manifest.files = declared)),
        "codex",
      ),
    ).toThrow(UNAVAILABLE);
});

it("refuses files that differ from the declaration", () => {
  const withFiles = (
    change: (declared: Record<string, unknown>) => void,
  ): string =>
    build("codex", (manifest) => {
      const declared = files(manifest);
      change(declared);
      manifest.files = declared;
    });
  const entries: string[] = [
    withFiles((declared) => void (declared.extra = declared.LICENSE)),
    withFiles(
      (declared) =>
        void (declared.codex = {
          bytes: 6,
          sha256: sha("other"),
          mode: "0755",
        }),
    ),
    withFiles(
      (declared) =>
        void (declared.codex = {
          bytes: 5,
          sha256: sha("binary"),
          mode: "0755",
        }),
    ),
    withFiles(
      (declared) =>
        void (declared.codex = {
          bytes: 6,
          sha256: sha("binary"),
          mode: "0700",
        }),
    ),
  ];
  const unlisted = build();
  writeFileSync(path.join(unlisted, "stray"), "x");
  entries.push(unlisted);
  for (const directory of entries)
    expect(() => verifyPicaNativeArtifact(directory, "codex")).toThrow(
      UNAVAILABLE,
    );
});

it("verifies nested files and refuses unsafe nested directories", () => {
  const nested = (mode: number): string => {
    const directory = build("codex", (manifest) => {
      manifest.files = {
        ...files(manifest),
        "lib/inner.so": { bytes: 1, sha256: sha("x"), mode: "0644" },
      };
    });
    mkdirSync(path.join(directory, "lib"));
    chmodSync(path.join(directory, "lib"), mode);
    writeFileSync(path.join(directory, "lib", "inner.so"), "x");
    chmodSync(path.join(directory, "lib", "inner.so"), 0o644);
    return directory;
  };
  expect(verifyPicaNativeArtifact(nested(0o755), "codex").runner).toBe("codex");
  expect(() => verifyPicaNativeArtifact(nested(0o777), "codex")).toThrow(
    UNAVAILABLE,
  );
});

it("refuses special files, linked files and oversized files", () => {
  const special = build();
  symlinkSync(path.join(special, "LICENSE"), path.join(special, "link"));
  expect(() => verifyPicaNativeArtifact(special, "codex")).toThrow(UNAVAILABLE);
  const swapped = build();
  rmSync(path.join(swapped, "LICENSE"));
  symlinkSync(path.join(swapped, "codex"), path.join(swapped, "LICENSE"));
  expect(() => verifyPicaNativeArtifact(swapped, "codex")).toThrow(UNAVAILABLE);
  const writable = build();
  chmodSync(path.join(writable, "LICENSE"), 0o666);
  expect(() => verifyPicaNativeArtifact(writable, "codex")).toThrow(
    UNAVAILABLE,
  );
  const large = build("codex", (manifest) => {
    manifest.files = {
      ...files(manifest),
      codex: { bytes: 6, sha256: sha("binary"), mode: "0755" },
    };
  });
  const handle = openSync(path.join(large, "codex"), "r+");
  ftruncateSync(handle, 513 * 1024 * 1024);
  closeSync(handle);
  expect(() => verifyPicaNativeArtifact(large, "codex")).toThrow(UNAVAILABLE);
  const hardLinked = build();
  linkSync(path.join(hardLinked, "LICENSE"), path.join(base, "second"));
  expect(verifyPicaNativeArtifact(hardLinked, "codex").runner).toBe("codex");
});

it("refuses a build with more files than the limit", () => {
  const crowded = build();
  mkdirSync(path.join(crowded, "many"));
  for (let index = 0; index < 4097; index += 1)
    writeFileSync(path.join(crowded, "many", `f${index}`), "");
  expect(() => verifyPicaNativeArtifact(crowded, "codex")).toThrow(UNAVAILABLE);
});

it("hashes a build once and again after the executable changed", () => {
  const directory = build();
  const first = verifyPicaNativeArtifact(directory, "codex");
  writeFileSync(path.join(directory, "stray"), "x");
  expect(verifyPicaNativeArtifact(directory, "codex")).toEqual(first);
  const later = new Date(Date.now() + 60_000);
  utimesSync(path.join(directory, "codex"), later, later);
  expect(() => verifyPicaNativeArtifact(directory, "codex")).toThrow(
    UNAVAILABLE,
  );
});

it("wraps unexpected failures as an unavailable build", () => {
  const directory = build();
  rmSync(path.join(directory, "codex"));
  expect(() => verifyPicaNativeArtifact(directory, "codex")).toThrow(
    UNAVAILABLE,
  );
});
