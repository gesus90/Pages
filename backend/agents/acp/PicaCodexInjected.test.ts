import { expect, it } from "vitest";

import { PICA_CODEX_INJECTED } from "@/backend/agents/acp/PicaCodexInjected";

it("embeds the glue loader and the private adapter hooks", () => {
  expect(PICA_CODEX_INJECTED).toContain("createPicaCodexGlue");
  for (const hook of [
    "pagesAttachClient",
    "pagesCatalog",
    "pagesBindThread",
    "pagesPrepareTurn",
    "pagesRegistryReady",
    "pagesRegistryRevoked",
    "pagesThreadInvalidated",
    "pagesCall",
    "pagesCloseThread",
  ])
    expect(PICA_CODEX_INJECTED).toMatch(new RegExp(`function ${hook}\\b`, "u"));
});
