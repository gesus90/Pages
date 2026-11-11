import { useEffect, useState } from "react";

import { backendRequestHeaders } from "@/app/lib/backend-request";

/** What a view knows about a profile endpoint it reads. */
export interface ProfileEndpointState<Data> {
  readonly data: Data | null;
  readonly isLoading: boolean;
  /** The error code of a refusal, such as `forbidden`; `null` without one. */
  readonly errorCode: string | null;
}

const IDLE = { data: null, isLoading: false, errorCode: null } as const;

/** Reads the error code out of the body of a refusal. */
async function refusalCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body === "object" && body !== null && "error" in body)
    return String(body.error);
  return "unavailable";
}

/**
 * Reads a read-only profile endpoint of the user management (PAGE-308)
 * while the view shows it.
 *
 * @param url - The endpoint; `null` reads nothing.
 * @param isData - Narrows the answer to the expected data.
 */
export function useProfileEndpoint<Data>(
  url: string | null,
  isData: (value: unknown) => value is Data,
): ProfileEndpointState<Data> {
  const [state, setState] = useState<ProfileEndpointState<Data>>(IDLE);
  useEffect(() => {
    if (url === null) {
      setState(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    setState({ data: null, isLoading: true, errorCode: null });
    void fetch(url, {
      cache: "no-store",
      headers: backendRequestHeaders({ Accept: "application/json" }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          return setState({
            data: null,
            isLoading: false,
            errorCode: await refusalCode(response),
          });
        const payload: unknown = await response.json();
        setState(
          isData(payload)
            ? { data: payload, isLoading: false, errorCode: null }
            : { data: null, isLoading: false, errorCode: "unavailable" },
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[pages] The agent profile could not be read.", error);
        setState({ data: null, isLoading: false, errorCode: "unavailable" });
      });
    return () => controller.abort();
  }, [url, isData]);
  return state;
}
