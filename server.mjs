// Starts the Pages production server from the build output.
// React reads NODE_ENV when it loads, so it is set before the build is imported.
process.env.NODE_ENV ??= "production";

const { startServer } = await import("./build/server/index.js");

process.exitCode = await startServer(process.argv.slice(2));
