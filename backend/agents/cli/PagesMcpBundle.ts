import path from "node:path";
import { fileURLToPath } from "node:url";

import manifest from "../../../mcp/package.json";

/** Static version metadata of the independently built Pages MCP package. */
export const PAGES_MCP_VERSION = manifest.version;

/** Resolves the operator override, shipped production bundle or development package artifact. */
export function pagesMcpBundlePath(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment.PAGES_MCP_BUNDLE?.trim();
  if (configured) return path.resolve(configured);
  const fileName = `pages-mcp-v${manifest.version}.cjs`;
  if (import.meta.env?.PROD)
    return fileURLToPath(new URL(`./${fileName}`, import.meta.url));
  return path.resolve("mcp", "dist", fileName);
}
