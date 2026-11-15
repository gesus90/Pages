import { useEffect, useState } from "react";
import { z } from "zod";

import { codexRunUsageSchema } from "@/definition/CodexPlanUsage";

import type { CodexRunUsage } from "@/definition/CodexPlanUsage";

const responseSchema = z.object({
  view: z.object({ codexRunUsage: codexRunUsageSchema }),
});

/** Polls the authorized projection while the run panel is mounted; unreported usage stays unknown. */
export function useCodexRunUsage(url: string | null): CodexRunUsage | null {
  const [view, setView] = useState<{
    readonly url: string;
    readonly usage: CodexRunUsage;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    const target = url;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh(): Promise<void> {
      try {
        const response = await fetch(target, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          const result = responseSchema.safeParse(payload);
          if (result.success && !controller.signal.aborted)
            setView({ url: target, usage: result.data.view.codexRunUsage });
        }
      } catch {
        // An unavailable projection retains the last report; it never substitutes zero usage.
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void refresh();
          }, 2_000);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [url]);
  return view?.url === url ? view.usage : null;
}
