// Standalone integration process, using the same versioned application bundle.
process.env.NODE_ENV ??= "production";
try {
  const { startIntegrations } = await import("./build/server/index.js");
  await startIntegrations(process.argv.slice(2));
} catch {
  process.stderr.write(
    "pages-integrations could not load; verify the build and installed dependencies.\n",
  );
  process.exitCode = 1;
}
