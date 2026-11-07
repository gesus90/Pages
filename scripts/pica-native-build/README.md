# Pica native candidate builders

These builders produce the native Codex and OpenCode candidates that Pica's chat selects. They establish neither runtime safety nor acceptance by themselves: Pages starts a candidate only after `PicaNativeArtifact` has verified the installed copy against its manifest and pinned patch, and each Codex thread start must still return the policy acknowledgement. Claude Code has no non-MCP native producer; its Pica launch stays refused. Review this code and the native patches before any future build. Byte-for-byte reproducibility is not established: the manifest records pinned inputs, commands and resulting hashes, not a reproducibility proof.

## Input contract

Future invocation uses Python 3 on Linux with user namespaces and a private, caller-owned 0700 input root and a separate private 0700 output parent. Existing input paths are absolute, normalized, have no symlink components, and must exist within `input_root`; all supplied trees and files must have no write bits. The new output must be outside `input_root` under a separate owned private parent. Input trees cannot contain devices, sockets or external/absolute/broken symlinks. The source must be a complete clean Git checkout at the pinned commit, including its own `.git` directory; ignored files are refused. The checkout, tools, caches, sysroot, assets and snapshot are explicit inputs, not downloads or global configuration. `/usr/bin/git` and `/usr/bin/bwrap` are host-provisioned root-owned executables under root-owned, non-group/world-writable directories; missing or unsafe tools fail closed. Git repository operations run in a networkless bubblewrap namespace with a separate home and hooks disabled. This trust model assumes host root and these tools are trustworthy; caller-provided hashes alone are not an authority. `toolchain` has `bin/cargo` and `bin/rustc` for Codex, or `bin/bun` for OpenCode; `build_tools/bin` supplies any other required build executables. `sysroot` supplies `usr` and, where needed, `lib` and `lib64` for the isolated build. Rust toolchains must be actual binaries, not rustup download proxies. Cargo `cache` must contain the required registry and git data. OpenCode `dependencies` is an overlay copied into the staged source: the root `node_modules` of a hoisted `bun install --frozen-lockfile --ignore-scripts` plus the `packages/*/node_modules` that install produced. Its workspace links may point into the staged source and are checked lexically; `cache` may be empty because the build runs with `--skip-install`. The builder does not install anything. `runtime_assets` supplies the candidate's separately packaged runtime files; no symlinks or names outside `[A-Za-z0-9_.+/-]` are accepted. Determining the complete runtime dependency closure is still outstanding.

Each path input is `{"path":"/absolute/path", "sha256":"<64 lowercase hex>"}`. A file hash is SHA-256 of its bytes. The `pages-tree-sha256-v2` directory hash walks paths in deterministic `os.walk` order, sorting directories and then each directory's combined names, excluding only the source checkout root `.git`; all entries of non-source input trees, including nested `.git` directories, are hashed. Each entry adds a UTF-8 JSON array `[relative_path, kind, numeric_mode, content]` with ASCII escapes and compact separators, followed by newline. `kind` is `file`, `dir`, or `link`; content is the file SHA-256, empty string, or relative symlink target respectively. Modes are the numeric permission bits. The root entry itself is not included. The caller must obtain and independently verify the expected tree digests; the builder compares them before staging. This input contract deliberately does not invent hashes for absent caches or snapshots.

Example Codex input shape (replace every placeholder with separately verified real values):

```json
{
  "input_root": "/private/build-inputs",
  "source": {"path": "/private/build-inputs/codex-source", "sha256": "SOURCE_TREE_SHA256"},
  "toolchain": {"path": "/private/build-inputs/rust-1.95.0", "sha256": "TOOLCHAIN_TREE_SHA256"},
  "build_tools": {"path": "/private/build-inputs/build-tools", "sha256": "TOOLS_TREE_SHA256"},
  "cache": {"path": "/private/build-inputs/cargo-cache", "sha256": "CACHE_TREE_SHA256"},
  "sysroot": {"path": "/private/build-inputs/sysroot", "sha256": "SYSROOT_TREE_SHA256"},
  "runtime_assets": {"path": "/private/build-inputs/runtime-assets", "sha256": "ASSETS_TREE_SHA256"},
  "target": {"os": "linux", "arch": "x64", "abi": "glibc"},
  "output": "/private/build-output/codex-candidate"
}
```

For OpenCode use the same keys with its source, Bun toolchain and cache, plus:

```json
"dependencies": {"path": "/private/build-inputs/node_modules", "sha256": "DEPENDENCIES_TREE_SHA256"},
"models_snapshot": {"path": "/private/build-inputs/models.json", "sha256": "MODELS_FILE_SHA256"}
```

The target must match the host (`x64` or `arm64`, Linux glibc). The output must not already exist and must be outside the input root. Set `PICA_BUILD_KEEP=1` to keep the staging folder of a build (for incremental repairs); otherwise it is removed. Commands:

```sh
python3 scripts/pica-native-build/build.py codex /private/codex-inputs.json
python3 scripts/pica-native-build/build.py opencode /private/opencode-inputs.json
```

## Build definitions

The pinned Codex release's committed lockfile records 159 workspace versions as `0.0.0` while its workspace version is `0.160.0`; Cargo 1.95 refuses that combination with `--locked`. The builder verifies the pinned original lock and normalizes exactly those versions in its private staged copy, checks the resulting SHA-256 `f0ea6b033508c394980bfc011907947beffcb7f7b1a56addbff90196617c14a4`, and records both the original and effective build lock hashes. No dependency versions are changed by this normalization.

Codex uses `rust-v0.160.0` commit `a956835d020762cb2b570053af06f643a11c0ecc`, Rust/Cargo 1.95.0, `Cargo.lock` SHA-256 `5553f06583159ed64666b6eb4beea3154e06b612e6312528131bdc226a6a860c` and the retained Apache-2.0 policy patch. In isolated staging it runs `cargo build --release --offline --locked -p codex-cli --bin codex --manifest-path /build/source/codex-rs/Cargo.toml`, with explicit `CARGO_HOME`, `RUSTUP_HOME`, `RUSTC`, `CARGO_TARGET_DIR` and offline setting. The pinned upstream CLI manifest declares the `codex` bin; its justfile's development build uses `cargo build -p codex-cli` and its separate release path uses Bazel. This definition does not claim Cargo output is identical to the upstream Bazel release.

OpenCode uses commit `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`, Bun 1.3.14, `bun.lock` SHA-256 `04483150cfabd37bedae4055036cd7a665e3471053adad343cb1ccfbbca6c79c`, the retained MIT Pica patch and a separate build-only patch. The latter is pinned to the exact upstream `build.ts` hash and fails on release/upload mode or unexpected `Script.version`, and suppresses the same-platform `--version` smoke only for the offline build. The source command is `bun run --cwd /build/source/packages/opencode script/build.ts --single --skip-install --skip-embed-web-ui`. The `MODELS_DEV_API_JSON` environment variable names the copied, hash-bound local snapshot so `generate.ts` does not take its default `models.dev` fetch branch. Both commands execute inside bubblewrap with all namespaces unshared, including network; source and caches are copied to private staging and toolchain/build tools/sysroot are mounted read-only. No host HOME or global cache is passed through.

Both definitions preflight the declared hashes and pinned license, patch and key build inputs before staging. Candidate packages are assembled in a private temporary directory and published with Linux `renameat2(RENAME_NOREPLACE)` only after manifest creation. Failure before publication leaves no output path; process termination may leave a private staging directory requiring owner cleanup. The resulting `manifest.json` is the publication marker. The artifact file map excludes the manifest itself to avoid a self-hash cycle; it lists every other regular packaged file by unique relative path, SHA-256, mode and format. `artifact.schema.json` defines the `built-unverified` contract, including command, environment, working directory, source/patch/lock/toolchain/input hashes, target, expected version, candidate capability and OpenCode snapshot digest. A future consumer must independently validate the schema, compare the complete filesystem set to the map, verify every hash and mode, and reject undeclared files and symlinks, non-normalized path components, paths over 1024 characters, more than 4096 files, files over 512 MiB, and package contents over 2 GiB. Neither this schema nor a successful build verifies runtime asset closure, selected artifact identity, producer safety, protocol behavior, or the ticket.

No full OpenCode checkout, exact preloaded Bun/dependencies/models snapshot, or prepared offline Rust toolchain/cache has been established in the task workspace. The retained Codex snapshot is a source archive modified during attempt 18, not a clean complete Git checkout. Install a published candidate as a read-only, service-owned copy at `<instance>/tools/pica-native/codex` or `<instance>/tools/pica-native/opencode`. No project gates or provider/runtime proof are supplied here.
