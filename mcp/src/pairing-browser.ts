import { spawn } from "node:child_process";

/** Opens only in an interactive desktop session; opener failures leave terminal instructions available. */
export async function openPairingBrowser(
  link: URL,
  environment: Readonly<Record<string, string | undefined>>,
  options: {
    noBrowser: boolean;
    isTerminal: boolean;
    platform?: NodeJS.Platform;
  },
): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  if (
    options.noBrowser ||
    !options.isTerminal ||
    environment.SSH_CONNECTION ||
    environment.SSH_TTY ||
    (platform === "linux" &&
      !environment.DISPLAY &&
      !environment.WAYLAND_DISPLAY)
  )
    return false;
  if (platform !== "linux" && platform !== "darwin" && platform !== "win32")
    return false;
  const command = { linux: "xdg-open", darwin: "open", win32: "explorer.exe" }[
    platform
  ];
  return new Promise((resolve) => {
    const opener = spawn(command, [link.href], {
      shell: false,
      stdio: "ignore",
    });
    opener.once("error", () => resolve(false));
    opener.once("exit", (code) => resolve(code === 0));
  });
}
