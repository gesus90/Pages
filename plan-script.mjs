// Script capture has its own lifetime, independent of the plan service.
try {
  if (process.argv[3] === "source") {
    const { createServer } = await import("vite");
    const compiler = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: "custom",
    });
    const owner = await compiler.ssrLoadModule(
      "/backend/service/agents/AgentPlanScriptOwner.ts",
    );
    await owner.startPlanScriptOwner(process.argv[2]);
    await compiler.close();
  } else {
    const { startPlanScriptOwner } = await import("./build/server/index.js");
    await startPlanScriptOwner(process.argv[2]);
  }
} catch {
  process.stderr.write("Script owner could not initialize.\n");
  process.exitCode = 1;
}
