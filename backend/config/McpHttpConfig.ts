import { z } from "zod";

import { isLoopbackUrl } from "@/definition/McpOAuth";

import type { TomlTable } from "smol-toml";

/** The explicit external MCP address; no request header establishes this trust. */
export interface McpHttpConfig {
  readonly publicUrl: string;
}

const publicUrlSchema = z.url().refine((text) => {
  const url = new URL(text);
  return (
    url.origin === text &&
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackUrl(url)))
  );
});

/** Reads an opt-in HTTP MCP origin without replacing existing TOML settings. */
export function readMcpHttpConfig(table: TomlTable): {
  readonly mcpHttp?: McpHttpConfig;
  readonly listenAddress?: string;
} {
  const parsed = z
    .object({
      listenAddress: z.union([z.ipv4(), z.ipv6()]).optional(),
      mcpHttp: z.object({ publicUrl: publicUrlSchema }).optional(),
    })
    .safeParse(table);
  if (!parsed.success)
    throw new Error(
      "Invalid listenAddress or mcpHttp.publicUrl configuration.",
    );
  return parsed.data;
}
