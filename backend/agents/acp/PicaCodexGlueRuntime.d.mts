import type { PicaCodexGlue } from "./PicaCodexGlue";

/**
 * Creates the private client that forwards the adapter's native tool calls to Pages.
 * @param request - The adapter's ACP request callback.
 * @returns The glue the patched adapter drives.
 */
export function createPicaCodexGlue(request: unknown): PicaCodexGlue;
