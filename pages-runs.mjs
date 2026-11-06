// Same versioned application bundle as the API; a separate process owns scheduling.
process.env.NODE_ENV ??= "production";
try {
  const { startRuns } = await import("./build/server/index.js");
  await startRuns(process.argv.slice(2));
} catch {
  process.stderr.write(
    "pages-runs could not load; verify the build and installed dependencies.\n",
  );
  process.exitCode = 1;
}
