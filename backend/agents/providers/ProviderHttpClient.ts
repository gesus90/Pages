import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { AGENT_PROVIDERS } from "@/definition/AgentConnection";

import { classifyProviderError } from "./ProviderErrors";

import type {
  AgentCheckDetail,
  ApiProviderId,
} from "@/definition/AgentConnection";
import type {
  ProviderCheckOutcome,
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./ProviderContracts";

interface ProviderRequest {
  readonly provider: ApiProviderId;
  readonly apiKey: string;
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly parse: (payload: unknown) => AgentCheckDetail | null;
}

/** Builds provider-native authentication headers; keys never enter URLs. */
export function requestHeaders(
  provider: ApiProviderId,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (provider === "google_ai_studio") headers["x-goog-api-key"] = apiKey;
  else if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/** Sends bounded, non-retrying provider requests and returns only whitelisted outcomes. */
export class ProviderHttpClient {
  private readonly request: ProviderHttpTransport;

  public constructor(request: ProviderHttpTransport = fetch) {
    this.request = request;
  }

  /** Keys exist only in headers; redirects cannot forward them to another host. */
  public async check(
    input: ProviderRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const endpoint = AGENT_PROVIDERS[input.provider].endpoint;
    const detail = { endpoint: new URL(endpoint).hostname };
    let response: ProviderHttpResponse;
    try {
      signal.throwIfAborted();
      response = await this.request(`${endpoint}${input.path}`, {
        method: input.body === undefined ? "GET" : "POST",
        headers: requestHeaders(input.provider, input.apiKey),
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal,
        redirect: "error",
      });
    } catch {
      return {
        ok: false,
        errorCode: signal.aborted ? "check_timeout" : "provider_unreachable",
        detail,
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        errorCode: signal.aborted
          ? "check_timeout"
          : (classifyProviderError(response.status, null) ??
            "provider_bad_response"),
        detail,
      };
    }
    if (signal.aborted)
      return { ok: false, errorCode: "check_timeout", detail };
    const errorCode = classifyProviderError(response.status, payload);
    if (errorCode) return { ok: false, errorCode, detail };
    const parsed = input.parse(payload);
    if (parsed === null)
      return { ok: false, errorCode: "provider_bad_response", detail };
    return { ok: true, detail: { ...sanitizeCheckDetail(parsed), ...detail } };
  }
}
