// Same versioned application bundle as the API; this process only serves the
// static app and passes everything else to the API (PAGE-235).
process.env.NODE_ENV ??= "production";
try {
  const { startIngress } = await import("./build/server/index.js");
  await startIngress(process.argv.slice(2));
} catch {
  process.stderr.write(
    "pages-ingress could not load; verify the build and installed dependencies.\n",
  );
  process.exitCode = 1;
}
