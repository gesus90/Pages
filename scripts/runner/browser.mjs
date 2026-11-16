import { constants } from "node:fs";
import { access, lstat, mkdir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

/** Browser access is offered only when an administrator installed and selected the MCP executable. */
export async function browserCapabilities() {
  const file = process.env.PAGES_RUNNER_BROWSER_COMMAND;
  const browsers = process.env.PAGES_RUNNER_BROWSERS_PATH;
  if (!file?.startsWith("/") || !browsers?.startsWith("/")) return {};
  try {
    await access(file, constants.X_OK);
    await access(browsers, constants.R_OK);
    return { browserVersion: 1 };
  } catch {
    return {};
  }
}

/** An isolated sandboxed browser runs inside the job boundary under its selected account. */
export async function browserServer(command, jobId) {
  if (command.browser !== 1) return null;
  if (!/^[a-f0-9-]{36}$/u.test(jobId))
    throw new Error("Invalid browser job identity");
  if (
    command.program.access !== "yolo" ||
    !(await browserCapabilities()).browserVersion
  )
    throw new Error("Runner browser unavailable");
  const workspace = await realpath(command.workspace);
  const root = join(workspace, ".pages-artifacts");
  const output = join(root, jobId);
  for (const directory of [root, output]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const metadata = await lstat(directory);
    const path = relative(workspace, await realpath(directory));
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      path.startsWith("..") ||
      isAbsolute(path)
    )
      throw new Error("Browser output outside workspace");
  }
  return {
    name: "playwright",
    command: process.env.PAGES_RUNNER_BROWSER_COMMAND,
    args: [
      "--headless",
      "--browser",
      "chromium",
      "--isolated",
      "--sandbox",
      "--save-session",
      "--output-dir",
      output,
    ],
    env: [
      {
        name: "PLAYWRIGHT_BROWSERS_PATH",
        value: process.env.PAGES_RUNNER_BROWSERS_PATH,
      },
      { name: "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", value: "1" },
      { name: "PAGES_RUN_INSTANCE", value: jobId },
    ],
  };
}
