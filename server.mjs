// Starts the Pages production server from the build output.
// React reads NODE_ENV when it loads, so it is set before the build is imported.
process.env.NODE_ENV ??= "production";

try {
  const { startServer } = await import("./build/server/index.js");
  process.exitCode = await startServer(process.argv.slice(2));
} catch {
  // Module loading can fail before the logger exists. Never print raw import diagnostics.
  process.stderr.write(
    `${JSON.stringify({ schemaVersion: 1, time: new Date().toISOString(), severity: "fatal", event: "bootstrap.import.failed", component: "Bootstrap", pid: process.pid, instanceId: `bootstrap-${process.pid}`, message: "Server module could not load; verify the build and installed dependencies" })}\n`,
  );
  process.exitCode = 1;
}
