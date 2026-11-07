#!/usr/bin/env python3
"""Build the pinned native Pica candidates inside a networkless Linux namespace.

Inputs are supplied in a JSON file; see README.md. Pages selects the output through backend/agents/cli/PicaNativeArtifact.ts.
"""
import argparse
import ctypes
import hashlib
import json
import os
import platform
import re
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PINS = {
    "codex": {
        "commit": "a956835d020762cb2b570053af06f643a11c0ecc",
        "version": "0.160.0", "license": "Apache-2.0",
        "patch": "backend/agents/codex-patch/pages-tool-policy.patch",
        "patch_hash": "ae87b482ce96ae23b2b89499bb285de870bd90888d964e8db4a53489a398a588",
        "license_hash": "d17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc",
        "lock": "codex-rs/Cargo.lock",
        "lock_hash": "5553f06583159ed64666b6eb4beea3154e06b612e6312528131bdc226a6a860c",
        "toolchain_version": "1.95.0",
    },
    "opencode": {
        "commit": "aec0b9a6d8898f68f923aaf08b7306d931fd9d76",
        "version": "1.18.34", "license": "MIT",
        "patch": "backend/agents/opencode-patch/pages-pica.patch",
        "patch_hash": "aeb4124998396098f19fd3b5016e59cfe7d85e9acf7b2d655e43bfa612a16f3d",
        "license_hash": "625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b",
        "lock": "bun.lock",
        "lock_hash": "04483150cfabd37bedae4055036cd7a665e3471053adad343cb1ccfbbca6c79c",
        "toolchain_version": "1.3.14",
    },
}
OFFLINE_PATCH_HASH = "5edbc3c4f0c7c4cd4253bc8f2a7c76a190c02d32b3564f491faa70ecb74ff07b"
CODEX_BUILD_LOCK_HASH = "f0ea6b033508c394980bfc011907947beffcb7f7b1a56addbff90196617c14a4"


def fail(message):
    raise SystemExit(message)


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def link_stays_in_tree(root, path, target, is_overlay):
    """Whether a relative link resolves inside the tree.

    A dependency overlay is copied into the staged source, so its workspace
    links point at files that exist only there; they are checked lexically.
    """
    if os.path.isabs(target):
        return False
    relative = os.path.normpath(os.path.join(path.parent.relative_to(root).as_posix(), target))
    if relative == ".." or relative.startswith("../"):
        return False
    return is_overlay or (path.parent / target).resolve(strict=True).is_relative_to(root)


def tree_digest(root, source_metadata=False, is_overlay=False):
    """Hash sorted relative paths, modes, file contents and in-tree links."""
    root = root.resolve(strict=True)
    result = hashlib.sha256()
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(name for name in dirs if not (source_metadata and Path(directory) == root and name == ".git"))
        for name in sorted(dirs + files):
            path = Path(directory) / name
            info = path.lstat()
            relative = path.relative_to(root).as_posix()
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                if not link_stays_in_tree(root, path, target, is_overlay):
                    fail("Unsafe input symlink: " + relative)
                kind, content = "link", target
            elif stat.S_ISREG(info.st_mode):
                kind, content = "file", digest(path)
            elif stat.S_ISDIR(info.st_mode):
                kind, content = "dir", ""
            else:
                fail("Unsupported input file: " + relative)
            record = json.dumps([relative, kind, stat.S_IMODE(info.st_mode), content], ensure_ascii=True, separators=(",", ":"))
            result.update(record.encode() + b"\n")
    return result.hexdigest()


def normalized_relative(value):
    return bool(value and len(value) <= 1024 and not value.startswith("/") and "\\" not in value and all(part not in {"", ".", ".."} and re.fullmatch(r"[A-Za-z0-9_.+-]+", part) for part in value.split("/")))


def require_readonly(path):
    entries = [path]
    if path.is_dir():
        for directory, dirs, files in os.walk(path, followlinks=False):
            entries.extend(Path(directory) / name for name in dirs + files)
    for entry in entries:
        info = entry.lstat()
        if not stat.S_ISLNK(info.st_mode) and stat.S_IMODE(info.st_mode) & 0o222:
            fail("Input must be read-only: " + str(entry))


def make_staging_writable(root):
    for directory, dirs, files in os.walk(root, followlinks=False):
        for path in [Path(directory), *(Path(directory) / name for name in dirs + files)]:
            if not path.is_symlink():
                path.chmod(stat.S_IMODE(path.stat().st_mode) | 0o200)


def checked_path(config, key, directory=False):
    item = config.get(key)
    if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
        fail("Missing path and sha256 for " + key)
    path = Path(item["path"])
    if not path.is_absolute() or path.is_symlink() or not path.exists() or path.resolve() != path:
        fail("Missing or unsafe input: " + key)
    if directory != path.is_dir() or (not directory and not path.is_file()):
        fail("Wrong input type: " + key)
    actual = tree_digest(path, source_metadata=key == "source", is_overlay=key == "dependencies") if directory else digest(path)
    if actual != item["sha256"]:
        fail("Hash mismatch: " + key)
    require_readonly(path)
    return path.resolve()


def pinned_file(path, expected):
    if not path.is_file() or path.is_symlink() or digest(path) != expected:
        fail("Pinned file mismatch: " + str(path))


def trusted_host_tool(name):
    path = Path("/usr/bin") / name
    for component in (Path("/"), Path("/usr"), Path("/usr/bin"), path):
        info = component.lstat()
        expected = stat.S_ISREG(info.st_mode) if component == path else stat.S_ISDIR(info.st_mode)
        if not expected or info.st_uid != 0 or info.st_mode & 0o022:
            fail("Missing or untrusted host tool: " + str(component))
    if not os.access(path, os.X_OK):
        fail("Host tool not executable: " + str(path))
    return path


def isolated_git(git, bwrap, source, args, patch=None, writable=False):
    mounts = ["--bind" if writable else "--ro-bind", str(source), "/source"]
    if patch is not None:
        mounts += ["--ro-bind", str(patch), "/patch"]
    command = [str(bwrap), "--die-with-parent", "--unshare-all", "--new-session", "--ro-bind", "/usr", "/usr"]
    for name in ("/lib", "/lib64"):
        if Path(name).exists():
            command += ["--ro-bind", name, name]
    command += ["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", *mounts, "--chdir", "/source", "--setenv", "HOME", "/tmp", "--setenv", "PATH", "", "--setenv", "GIT_CONFIG_NOSYSTEM", "1", "--setenv", "GIT_CONFIG_GLOBAL", "/dev/null", "--setenv", "GIT_NO_REPLACE_OBJECTS", "1", "--setenv", "GIT_OPTIONAL_LOCKS", "0", "--setenv", "GIT_CONFIG_COUNT", "2", "--setenv", "GIT_CONFIG_KEY_0", "core.fsmonitor", "--setenv", "GIT_CONFIG_VALUE_0", "false", "--setenv", "GIT_CONFIG_KEY_1", "core.hooksPath", "--setenv", "GIT_CONFIG_VALUE_1", "/dev/null", "--", str(git), *args]
    return subprocess.check_output(command, env={"PATH": ""}, text=True).strip()


def preflight(config, kind):
    pin = PINS[kind]
    keys = {"source", "toolchain", "build_tools", "cache", "output", "target", "input_root", "runtime_assets", "sysroot"}
    if kind == "opencode":
        keys |= {"dependencies", "models_snapshot"}
    if set(config) != keys:
        fail("Unexpected or missing builder input keys")
    root = Path(config["input_root"])
    if not root.is_absolute() or root.is_symlink() or not root.is_dir() or root.stat().st_uid != os.getuid() or stat.S_IMODE(root.stat().st_mode) & 0o077:
        fail("Input root must be an owned private directory")
    if root.resolve(strict=True) != root:
        fail("Input root must not traverse symlinks")
    root = root.resolve(strict=True)
    paths = {key: checked_path(config, key, directory=key in {"source", "toolchain", "build_tools", "cache", "dependencies", "runtime_assets", "sysroot"}) for key in keys - {"output", "target", "input_root"}}
    if any(not path.is_relative_to(root) for path in paths.values()):
        fail("All inputs must be within the private input root")
    if not (paths["sysroot"] / "usr").is_dir():
        fail("Sysroot must contain usr")
    paths["git"] = trusted_host_tool("git")
    paths["bwrap"] = trusted_host_tool("bwrap")
    source, git = paths["source"], paths["git"]
    if not (source / ".git").is_dir() or (source / ".git").is_symlink():
        fail("Source requires its own full Git checkout")
    def git_read(*args):
        return isolated_git(git, paths["bwrap"], source, args)
    if git_read("rev-parse", "HEAD") != pin["commit"] or git_read("status", "--porcelain", "--untracked-files=all") or git_read("clean", "-ndx"):
        fail("Source checkout must be clean and at pinned commit")
    manifest_file = REPO / ("backend/agents/" + kind + "-patch/manifest.json")
    manifest_hash = {"codex": "88ab934d494858833e3609ec07da0589ea66ccc13004b0cd3be4a78a6872bc7e", "opencode": "434d967b75a0a5af010e33d8c654e998a5e0e74e2c46fc3cd8586a9e8328f0b1"}[kind]
    pinned_file(manifest_file, manifest_hash)
    manifest = json.loads(manifest_file.read_text())
    for name, expected in manifest["sourceSha256"].items():
        pinned_file(source / name, expected)
    pinned_file(source / "LICENSE", pin["license_hash"])
    pinned_file(source / pin["lock"], pin["lock_hash"])
    pinned_file(REPO / pin["patch"], pin["patch_hash"])
    if kind == "opencode":
        pinned_file(source / "package.json", "6ae4dee9338c330571a2a485e27c8feab3e78eb31f125605a540a2d13dc80e45")
        pinned_file(source / "packages/opencode/package.json", "d07f8eeb436c2f29671382cdbb4decf49f2e10e6603e91c6cda78d3ee4cbc4fb")
        pinned_file(source / "bunfig.toml", "ed50f5745fbcb845251debe79cc464a2142c62cf17a013c2a29de38bf248f158")
        pinned_file(source / "packages/opencode/script/build.ts", "37362ba0ff8f0d82a917970a648fc79a4d35264a2fa405ca126e918a967563f9")
        pinned_file(source / "packages/opencode/script/generate.ts", "6351777e5e8bf0123f3ef31bc4fd13912ea7800249f130cb4893d8c9e8a16c0a")
        pinned_file(HERE / "opencode-offline.patch", OFFLINE_PATCH_HASH)
    else:
        pinned_file(source / "codex-rs/rust-toolchain.toml", "570656042681cfd8795403a455baf9a33035331a07db0645e866bbcea89a3d64")
        pinned_file(source / "codex-rs/Cargo.toml", "e558c28aaf94c9f20c7d57224eb9509084e31110850aad24d04bef7811dc335d")
        pinned_file(source / "codex-rs/cli/Cargo.toml", "e1205c8fbd3e5e8357c40587ff939dba8e458016e3d6c04c5b2547f943d01d09")
    target = config["target"]
    if not isinstance(target, dict) or set(target) != {"os", "arch", "abi"} or target["os"] != "linux" or target["arch"] not in {"x64", "arm64"} or target["abi"] != "glibc":
        fail("Only explicitly declared Linux glibc x64/arm64 targets are defined")
    expected_arch = {"x86_64": "x64", "aarch64": "arm64"}.get(platform.machine())
    if platform.system() != "Linux" or expected_arch != target["arch"] or platform.libc_ver()[0] != "glibc":
        fail("Target must match the Linux build host")
    output = Path(config["output"])
    if not output.is_absolute() or output.exists() or output.is_symlink():
        fail("Output must be a new absolute path")
    parent = output.parent.resolve(strict=True)
    if output.parent != parent or parent.is_relative_to(root) or parent.is_relative_to(REPO) or not parent.is_dir() or parent.stat().st_uid != os.getuid() or stat.S_IMODE(parent.stat().st_mode) & 0o077:
        fail("Output parent must be owned and private")
    return paths, output


def apply_patch(paths, source, patch):
    isolated_git(paths["git"], paths["bwrap"], source, ["apply", "--check", "/patch"], patch, writable=True)
    isolated_git(paths["git"], paths["bwrap"], source, ["apply", "/patch"], patch, writable=True)


def sandbox_command(paths, stage, command, env, cwd):
    args = [str(paths["bwrap"]), "--die-with-parent", "--unshare-all", "--new-session", "--ro-bind", str(paths["sysroot"] / "usr"), "/usr", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--bind", str(stage), "/build", "--ro-bind", str(paths["toolchain"]), "/toolchain", "--ro-bind", str(paths["build_tools"]), "/build-tools", "--chdir", cwd]
    for name in ("/lib", "/lib64"):
        candidate = paths["sysroot"] / name.lstrip("/")
        if candidate.exists():
            args.extend(["--ro-bind", str(candidate), name])
    for key, value in env.items():
        args.extend(["--setenv", key, value])
    args.extend(["--", *command])
    try:
        result = subprocess.run(args, check=True, env={"PATH": ""}, capture_output=True, text=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as error:
        import sys
        print(f"FAILED: {command}", file=sys.stderr)
        if error.stdout:
            print(f"STDOUT:\n{error.stdout}", file=sys.stderr)
        if error.stderr:
            print(f"STDERR:\n{error.stderr}", file=sys.stderr)
        raise


def verify_package(package, files):
    found = set()
    total = 0
    for directory, dirs, names in os.walk(package, followlinks=False):
        for name in dirs + names:
            entry = Path(directory) / name
            relative = entry.relative_to(package).as_posix()
            if not normalized_relative(relative) or entry.is_symlink():
                fail("Unsafe package entry")
            if entry.is_dir():
                continue
            if not entry.is_file():
                fail("Unsupported package entry")
            if relative == "manifest.json":
                continue
            if relative not in files or relative in found:
                fail("Undeclared or duplicate package file")
            info = entry.stat()
            total += info.st_size
            if len(found) >= 4096 or info.st_size > 512 * 1024 * 1024 or total > 2 * 1024 * 1024 * 1024:
                fail("Package resource limit exceeded")
            if info.st_size != files[relative]["bytes"] or digest(entry) != files[relative]["sha256"] or format(stat.S_IMODE(info.st_mode), "04o") != files[relative]["mode"]:
                fail("Package contents changed")
            found.add(relative)
    if found != set(files):
        fail("Package file set mismatch")


def publish(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        rename = libc.renameat2
    except AttributeError:
        fail("Atomic no-replace publication is unavailable")
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(destination))


def build(kind, config, paths, output):
    pin = PINS[kind]
    # PICA_BUILD_KEEP=1 keeps the staging folder, so a failed or reviewed build can be continued incrementally.
    keep = os.environ.get("PICA_BUILD_KEEP") == "1"
    with tempfile.TemporaryDirectory(prefix=".pica-build-", dir=output.parent, delete=not keep) as tmp:
        stage = Path(tmp)
        package = stage / "package"
        source = stage / "source"
        shutil.copytree(paths["source"], source, symlinks=True, ignore=lambda directory, names: [".git"] if Path(directory) == paths["source"] and ".git" in names else [])
        if tree_digest(source, source_metadata=True) != config["source"]["sha256"]:
            fail("Source changed while staging")
        make_staging_writable(source)
        apply_patch(paths, source, REPO / pin["patch"])
        if kind == "codex":
            # The pinned release changes the workspace version without updating
            # its committed lockfile. Normalize only those exact locked versions.
            lock = source / pin["lock"]
            original = lock.read_bytes()
            if hashlib.sha256(original).hexdigest() != pin["lock_hash"] or original.count(b'version = "0.0.0"') != 159:
                fail("Unexpected Codex lockfile before normalization")
            normalized = original.replace(b'version = "0.0.0"', b'version = "0.160.0"')
            if hashlib.sha256(normalized).hexdigest() != CODEX_BUILD_LOCK_HASH:
                fail("Unexpected normalized Codex lockfile")
            lock.write_bytes(normalized)
        if kind == "opencode":
            apply_patch(paths, source, HERE / "opencode-offline.patch")
            shutil.copytree(paths["dependencies"], source, symlinks=True, dirs_exist_ok=True)
            if tree_digest(paths["dependencies"], is_overlay=True) != config["dependencies"]["sha256"]:
                fail("Dependencies changed while staging")
            make_staging_writable(source)
            shutil.copyfile(paths["models_snapshot"], stage / "models.json")
            if digest(stage / "models.json") != config["models_snapshot"]["sha256"]:
                fail("Models snapshot changed while staging")
        shutil.copytree(paths["cache"], stage / "cache", symlinks=True)
        if tree_digest(stage / "cache") != config["cache"]["sha256"]:
            fail("Cache changed while staging")
        make_staging_writable(stage / "cache")
        (stage / "home").mkdir(mode=0o700)
        (stage / "target").mkdir(mode=0o700)
        env = {"HOME": "/build/home", "PATH": "/toolchain/bin:/build-tools/bin", "TMPDIR": "/tmp", "CI": "1", "SOURCE_DATE_EPOCH": "0", "TZ": "UTC", "LANG": "C", "PAGES_OFFLINE_BUILD": "1"}
        if kind == "codex":
            env.update({"CARGO_HOME": "/build/cache", "RUSTUP_HOME": "/build/home/rustup", "RUSTC": "/toolchain/bin/rustc", "CARGO_NET_OFFLINE": "true", "CARGO_TARGET_DIR": "/build/target", "CC": "/usr/bin/clang-22", "CXX": "/usr/bin/clang++-22", "RUSTFLAGS": "-C linker=/usr/bin/clang-22", "HOST_RUSTFLAGS": "-C linker=/usr/bin/clang-22", "CARGO_BUILD_JOBS": "2", "CARGO_PROFILE_RELEASE_LTO": "off", "CARGO_PROFILE_RELEASE_DEBUG": "0", "CARGO_PROFILE_RELEASE_CODEGEN_UNITS": "16"})
            command = ["/toolchain/bin/cargo", "build", "-j", "2", "--release", "--offline", "--locked", "-p", "codex-cli", "--bin", "codex", "--manifest-path", "/build/source/codex-rs/Cargo.toml"]
            binary = stage / "target/release/codex"
        else:
            env.update({"MODELS_DEV_API_JSON": "/build/models.json", "BUN_INSTALL_CACHE_DIR": "/build/cache", "OPENCODE_CHANNEL": "latest", "OPENCODE_VERSION": pin["version"]})
            command = ["/toolchain/bin/bun", "run", "--cwd", "/build/source/packages/opencode", "script/build.ts", "--single", "--skip-install", "--skip-embed-web-ui"]
            binary = source / ("packages/opencode/dist/opencode-linux-" + config["target"]["arch"] + "/bin/opencode")
        cwd = "/build/source/codex-rs" if kind == "codex" else "/build/source"
        if kind == "codex":
            if not sandbox_command(paths, stage, ["/toolchain/bin/rustc", "--version"], env, cwd).startswith("rustc 1.95.0 "):
                fail("Rust compiler version mismatch")
            if not sandbox_command(paths, stage, ["/toolchain/bin/cargo", "--version"], env, cwd).startswith("cargo 1.95.0 "):
                fail("Cargo version mismatch")
        elif sandbox_command(paths, stage, ["/toolchain/bin/bun", "--version"], env, cwd) != "1.3.14":
            fail("Bun version mismatch")
        sandbox_command(paths, stage, command, env, cwd)
        if not binary.is_file() or binary.is_symlink() or binary.resolve() != binary:
            fail("Build did not produce the expected regular artifact")
        with binary.open("rb") as stream:
            if stream.read(4) != b"\x7fELF":
                fail("Artifact is not ELF")
        package.mkdir(mode=0o700)
        artifact = package / kind
        shutil.copyfile(binary, artifact)
        artifact.chmod(0o500)
        shutil.copyfile(source / "LICENSE", package / "LICENSE")
        (package / "LICENSE").chmod(0o400)
        for item in (artifact, package / "LICENSE"):
            os.utime(item, (0, 0))
        for directory, dirs, names in os.walk(paths["runtime_assets"], followlinks=False):
            dirs.sort()
            for name in sorted(dirs + names):
                entry = Path(directory) / name
                if entry.is_symlink():
                    fail("Runtime asset symlinks are not supported")
                relative = entry.relative_to(paths["runtime_assets"])
                if not normalized_relative(relative.as_posix()):
                    fail("Unsupported runtime asset name")
                destination = package / "runtime" / relative
                if entry.is_dir():
                    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
                elif entry.is_file():
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    shutil.copyfile(entry, destination)
                    destination.chmod(0o500 if entry.stat().st_mode & 0o111 else 0o400)
                    os.utime(destination, (0, 0))
                else:
                    fail("Unsupported runtime asset")
        if tree_digest(paths["runtime_assets"]) != config["runtime_assets"]["sha256"]:
            fail("Runtime assets changed while packaging")
        files = {}
        for directory, dirs, names in os.walk(package):
            dirs.sort()
            for name in sorted(names):
                file = Path(directory) / name
                relative = file.relative_to(package).as_posix()
                if not normalized_relative(relative) or file.is_symlink() or not file.is_file() or file.stat().st_size > 512 * 1024 * 1024 or len(files) >= 4096:
                    fail("Unsafe or oversized package")
                if relative in files:
                    fail("Duplicate artifact path")
                files[relative] = {"sha256": digest(file), "bytes": file.stat().st_size, "mode": format(stat.S_IMODE(file.stat().st_mode), "04o"), "format": "ELF" if relative == kind else "text" if relative == "LICENSE" else "asset"}
        manifest = {"schemaVersion": 1, "status": "built-unverified", "runner": kind, "upstream": {"repo": "https://github.com/openai/codex" if kind == "codex" else "https://github.com/anomalyco/opencode", "version": pin["version"], "commit": pin["commit"], "license": pin["license"], "licenseSha256": pin["license_hash"]}, "sourceTree": {"method": "pages-tree-sha256-v2", "sha256": config["source"]["sha256"]}, "patches": [{"path": pin["patch"], "sha256": pin["patch_hash"]}] + ([{"path": "scripts/pica-native-build/opencode-offline.patch", "sha256": OFFLINE_PATCH_HASH}] if kind == "opencode" else []), "recipeSha256": digest(Path(__file__)), "lockSha256": pin["lock_hash"], "buildLockSha256": CODEX_BUILD_LOCK_HASH if kind == "codex" else pin["lock_hash"], "toolchain": {"version": pin["toolchain_version"], "treeSha256": config["toolchain"]["sha256"]}, "inputHashes": {key: digest(paths[key]) if key in {"git", "bwrap"} else config[key]["sha256"] for key in sorted(paths)}, "target": config["target"], "command": command, "environment": env, "workingDirectory": cwd, "runtimeClosure": "unverified", "modelsSnapshotSha256": config["models_snapshot"]["sha256"] if kind == "opencode" else None, "expectedVersion": pin["version"], "capabilities": ["pica-tool-policy-candidate" if kind == "codex" else "pica-native-tools-candidate"], "files": files}
        manifest_path = package / ".manifest.tmp"
        manifest_path.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
        manifest_path.chmod(0o400)
        os.replace(manifest_path, package / "manifest.json")
        verify_package(package, files)
        publish(package, output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("runner", choices=sorted(PINS))
    parser.add_argument("inputs", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(args.inputs.read_text())
    paths, output = preflight(config, args.runner)
    build(args.runner, config, paths, output)


if __name__ == "__main__":
    main()
