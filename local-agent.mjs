import { fileURLToPath } from "node:url";

// The native owner loads only its dedicated execution bundle.
process.env.NODE_ENV ??= "production";

try {
  if (process.env.PAGES_LOCAL_OWNER_SOURCE === "1") {
    const { createServer } = await import("vite");
    const root = fileURLToPath(new URL(".", import.meta.url));
    const compiler = await createServer({
      configFile: false,
      root,
      resolve: { alias: { "@": root } },
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
    const owner = await compiler.ssrLoadModule(
      "/backend/agents/local/LocalSessionOwner.ts",
    );
    await owner.startLocalSessionOwner(process.argv.slice(2));
  } else {
    const { startLocalSessionOwner } =
      await import("./build/local-owner/index.js");
    await startLocalSessionOwner(process.argv.slice(2));
  }
} catch {
  process.stderr.write("Local native session owner could not initialize.\n");
  process.exit(1);
}
