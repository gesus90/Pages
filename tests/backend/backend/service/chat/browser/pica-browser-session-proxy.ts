import { vi } from "vitest";

import type { PICA_BROWSER_NETWORK_LIMITS } from "@/backend/service/chat/browser/PicaBrowserProxy";

/** What the replaced proxy saw: the hosts it was built with, its routed requests and its refusal. */
export const proxies = {
  hosts: [] as unknown[],
  handle: vi.fn(),
  refusal: null as string | null,
};

interface PicaBrowserProxyModule {
  readonly PICA_BROWSER_NETWORK_LIMITS: typeof PICA_BROWSER_NETWORK_LIMITS;
}

/** Builds the module that replaces the browser proxy; the real network limits stay. */
export async function createProxyModule(): Promise<object> {
  const original: PicaBrowserProxyModule = await vi.importActual(
    "@/backend/service/chat/browser/PicaBrowserProxy",
  );
  class FakeProxy {
    public constructor(host: unknown) {
      proxies.hosts.push(host);
    }

    /**
     *
     */
    public handle(route: unknown): unknown {
      return proxies.handle(route);
    }

    /**
     *
     */
    public takeRefusal(): string | null {
      const refusal = proxies.refusal;
      proxies.refusal = null;
      return refusal;
    }
  }
  return {
    PICA_BROWSER_NETWORK_LIMITS: original.PICA_BROWSER_NETWORK_LIMITS,
    PicaBrowserProxy: FakeProxy,
  };
}

/** Clears what the replaced proxy remembered. */
export function resetProxies(): void {
  proxies.hosts.length = 0;
  proxies.handle.mockReset();
  proxies.refusal = null;
}
