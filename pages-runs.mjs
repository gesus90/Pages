// Dedicated plan runtime; the API owns HTTP, integrations and chat services.
process.env.NODE_ENV ??= "production";
try {
  const { startRuns } = await import("./build/runs/index.js");
  await startRuns(process.argv.slice(2));
} catch {
  process.stderr.write(
    "pages-runs could not load; verify the build and installed dependencies.\n",
  );
  process.exitCode = 1;
}
