import type { WikiSearchInput } from "@/backend/service/WikiService";

const EMPTY_VALUE = "";

function readOptional(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)?.trim() ?? EMPTY_VALUE;

  return value === EMPTY_VALUE ? null : value;
}

/**
 * Reads the search dialog's parameters from a request address.
 *
 * @param params - Query string of the search request.
 * @returns The search input; missing parameters mean "no filter".
 */
export function readSearchParams(params: URLSearchParams): WikiSearchInput {
  return {
    creatorId: readOptional(params, "creator"),
    editedFrom: readOptional(params, "from"),
    editedTo: readOptional(params, "to"),
    location: readOptional(params, "location"),
    sort: readOptional(params, "sort"),
    text: params.get("q") ?? EMPTY_VALUE,
    titleOnly: params.get("titleOnly") === "1",
    underPageId: readOptional(params, "under"),
  };
}

/**
 * Writes the search input as a query string.
 *
 * @param input - The search dialog's state.
 * @returns A query string without a leading question mark; empty values are
 * left out.
 */
export function writeSearchParams(input: WikiSearchInput): string {
  const params = new URLSearchParams();
  const entries: readonly [string, string | null][] = [
    ["q", input.text.trim() === EMPTY_VALUE ? null : input.text],
    ["location", input.location],
    ["under", input.underPageId],
    ["creator", input.creatorId],
    ["from", input.editedFrom],
    ["to", input.editedTo],
    ["sort", input.sort],
    ["titleOnly", input.titleOnly ? "1" : null],
  ];

  for (const [name, value] of entries) {
    if (value !== null) {
      params.set(name, value);
    }
  }

  return params.toString();
}
