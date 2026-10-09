import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";

// No browser, document or provider exists during SSR.
describe("assistant SSR safety", () => {
  it("can initialize an explicit selection entry without reading the browser or generating", () => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    function ServerController() {
      const assistant = useTextAssistant({
        context: { kind: "wiki", id: "p", version: "1" },
        title: "Page",
        handle: { current: null },
        content: "Saved document",
        canEdit: false,
        canSend: true,
        maximumLength: 100,
      });
      if (!assistant.panel.isOpen) assistant.editorFeature.open("explain");
      return <p>{assistant.panel.form.scope}</p>;
    }
    expect(renderToString(<ServerController />)).toContain("selection");
    expect(network).not.toHaveBeenCalled();
  });
});
