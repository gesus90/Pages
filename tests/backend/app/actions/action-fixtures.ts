import type { Mock } from "vitest";
import type { SettingsActionContext } from "@/app/lib/settings-actions/settings-action-support.server";
import type { ApplicationServices } from "@/app/lib/services.server";
import type { User } from "@/definition/User";

/** A signed-in actor of the action handlers. */
export const ACTOR: User = {
  id: "actor",
  username: "actor",
  displayName: "Actor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/** Values of a form field; a list becomes repeated fields of that name. */
export type FormFields = Readonly<
  Record<string, string | File | readonly string[]>
>;

/** Builds the form data a browser submits for the given fields. */
export function formOf(fields: FormFields): FormData {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string" || value instanceof File) {
      form.append(name, value);
      continue;
    }

    for (const entry of value) {
      form.append(name, entry);
    }
  }

  return form;
}

/**
 * Presents a set of service fakes as the application services.
 *
 * @remarks
 * The services are classes with private members, so no fake can satisfy their
 * type; a handler only calls the members the test configured.
 */
export function servicesOf(fakes: object): ApplicationServices {
  return fakes as ApplicationServices;
}

/** What a handler answered, independent of data response or redirect. */
export interface ActionOutcome {
  readonly status: number;
  readonly body: unknown;
  readonly location: string | null;
  readonly headers: Headers;
}

interface DataResponseShape {
  readonly data: unknown;
  readonly init: ResponseInit | null;
}

function isDataResponse(value: unknown): value is DataResponseShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "init" in value
  );
}

/**
 * Normalizes the answer of an action handler.
 *
 * @param result - A React Router data response or a plain response.
 * @returns Status, JSON body, redirect location and headers.
 */
export async function outcomeOf(result: unknown): Promise<ActionOutcome> {
  if (result instanceof Response) {
    const text = await result.text();

    return {
      body: text === "" ? null : (JSON.parse(text) as unknown),
      headers: result.headers,
      location: result.headers.get("Location"),
      status: result.status,
    };
  }

  if (isDataResponse(result)) {
    return {
      body: result.data,
      headers: new Headers(result.init?.headers),
      location: null,
      status: result.init?.status ?? 200,
    };
  }

  throw new Error("Expected a response or a data response.");
}

/**
 * Reads one argument of a recorded call of a mock.
 *
 * @param mock - The mock that was called.
 * @param call - Zero-based index of the call.
 * @param index - Zero-based index of the argument.
 * @returns The argument, or `undefined` when the call or argument is absent.
 */
export function callArgument(mock: Mock, call: number, index: number): unknown {
  const argumentsOfCall: unknown[] | undefined = mock.mock.calls[call];

  return argumentsOfCall?.[index];
}

/**
 * Builds the context of a settings action handler.
 *
 * @param services - Service fakes the handler may call.
 * @param fields - Form fields of the submission.
 * @param cookie - Value of the `Cookie` header, when the request has one.
 */
export function settingsContext(
  services: object,
  fields: FormFields,
  cookie?: string,
): SettingsActionContext {
  return {
    formData: formOf(fields),
    request: new Request("http://pages.invalid/settings", {
      headers: cookie === undefined ? {} : { Cookie: cookie },
      method: "POST",
    }),
    services: servicesOf(services),
    user: ACTOR,
  };
}

/**
 * Awaits work that has to reject with a response.
 *
 * @param work - Handler call that is expected to throw a response.
 * @returns The status of the thrown response.
 */
export async function thrownStatus(work: Promise<unknown>): Promise<number> {
  try {
    await work;
  } catch (error: unknown) {
    if (error instanceof Response) {
      return error.status;
    }

    throw error;
  }

  throw new Error("Expected a thrown response.");
}
