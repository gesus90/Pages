// The native protocol owner uses the same product module graph as Pages HTTP.
process.env.NODE_ENV ??= "production";

try {
  if (process.env.PAGES_LOCAL_OWNER_SOURCE === "1") {
    const { createServer } = await import("vite");
    const compiler = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
    const owner = await compiler.ssrLoadModule(
      "/backend/agents/local/LocalSessionOwner.ts",
    );
    await owner.startLocalSessionOwner(process.argv.slice(2));
  } else {
    const { startLocalSessionOwner } = await import("./build/server/index.js");
    await startLocalSessionOwner(process.argv.slice(2));
  }
} catch {
  process.stderr.write("Local native session owner could not initialize.\n");
  process.exit(1);
}
