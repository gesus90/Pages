process.env.NODE_ENV ??= "production";
try {
  const { observeServices } = await import("./build/server/index.js");
  await observeServices(process.argv.slice(2));
} catch {
  process.stderr.write(
    "Service restart observation failed; retained warnings remain available.\n",
  );
  process.exitCode = 1;
}
