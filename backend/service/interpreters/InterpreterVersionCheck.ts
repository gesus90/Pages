import { spawn } from "node:child_process";

import type {
  InterpreterCheck,
  InterpreterFailure,
} from "@/definition/InterpreterProfile";

const TIMEOUT_MS = 3000;
const MAX_OUTPUT_BYTES = 8192;

function failure(
  path: string,
  error: InterpreterFailure,
  diagnostic?: string,
): InterpreterCheck {
  return { path, status: "error", version: null, error, diagnostic };
}

function cleanOutput(output: string): string {
  return output
    .replace(/[\x00-\x1f\x7f-\x9f]/gu, " ")
    .trim()
    .slice(0, 240);
}

/** Executes only the concrete program with --version, bounded by time and output. */
export async function checkInterpreterVersion(
  path: string,
): Promise<InterpreterCheck> {
  return new Promise((resolve) => {
    const child = spawn(path, ["--version"], {
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let byteCount = 0;
    let isFinished = false;
    function killGroup(): void {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error: unknown) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ESRCH"
        ))
          console.warn(
            "[pages] Interpreter process group could not be stopped.",
          );
      }
    }
    function finish(result: InterpreterCheck): void {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      killGroup();
      resolve(result);
    }
    const timer = setTimeout(
      () => finish(failure(path, "timeout")),
      TIMEOUT_MS,
    );
    function receive(chunk: Buffer): void {
      byteCount += chunk.length;
      if (byteCount > MAX_OUTPUT_BYTES) {
        finish(failure(path, "outputLimit"));
        return;
      }
      output += chunk.toString("utf8");
    }
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", (error) => {
      const code = "code" in error ? error.code : "";
      if (code === "ENOENT" || code === "ENOTDIR")
        finish(failure(path, "missing"));
      else if (code === "EACCES" || code === "ENOEXEC")
        finish(failure(path, "notExecutable"));
      else finish(failure(path, "failed"));
    });
    child.once("close", (code) => {
      const diagnostic = cleanOutput(output);
      if (code !== 0) {
        finish(
          failure(path, "exit", `Exit ${code ?? "signal"}: ${diagnostic}`),
        );
        return;
      }
      const version = diagnostic.match(/\d+(?:\.\d+)+(?:[\w.+-]*)/u)?.[0];
      if (!version) {
        finish(failure(path, "noVersion", diagnostic));
        return;
      }
      finish({ path, status: "ok", version });
    });
  });
}
