import { z } from "zod";

import type { TomlTable } from "smol-toml";

/** Identifies exact loopback hosts for the public address check. */
function isLoopbackUrl(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
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

/** The address settings of the file: where the server listens and the origin it is reached at. */
export interface PublicAddressConfig {
  /** Interface the server listens on; missing: every interface. */
  readonly listenAddress?: string;
  /**
   * The origin users reach this instance at, as `https://pages.example`.
   * Pica's operator browser treats it as a Pages origin; no request header
   * establishes this trust.
   */
  readonly publicUrl?: string;
  /**
   * The origin the players of web export packages in the chat run on, as
   * `https://play.pages.example`: another host that reaches this instance and
   * never receives its sign-in. It takes effect only together with
   * `publicUrl`; missing: the players run in a frame with an opaque origin.
   */
  readonly chatPlayerOrigin?: string;
}

/**
 * Reads `listenAddress`, `publicUrl` and `chatPlayerOrigin` without replacing existing TOML settings.
 * @param table - Parsed TOML document.
 * @returns The address settings; `publicUrl` also reads the key `[mcpHttp].publicUrl` of earlier files.
 * @throws {Error} When one of the values is malformed.
 */
export function readPublicAddressConfig(table: TomlTable): PublicAddressConfig {
  const parsed = z
    .object({
      listenAddress: z.union([z.ipv4(), z.ipv6()]).optional(),
      publicUrl: publicUrlSchema.optional(),
      chatPlayerOrigin: publicUrlSchema.optional(),
      // Earlier files name the origin below the key of the removed MCP endpoint.
      mcpHttp: z.object({ publicUrl: publicUrlSchema }).optional(),
    })
    .safeParse(table);
  if (!parsed.success)
    throw new Error(
      "Invalid listenAddress, publicUrl or chatPlayerOrigin configuration.",
    );
  const { listenAddress, publicUrl, mcpHttp, chatPlayerOrigin } = parsed.data;
  const origin = publicUrl ?? mcpHttp?.publicUrl;
  return {
    ...(listenAddress === undefined ? {} : { listenAddress }),
    ...(origin === undefined ? {} : { publicUrl: origin }),
    ...(chatPlayerOrigin === undefined ? {} : { chatPlayerOrigin }),
  };
}
