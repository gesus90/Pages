import { beforeEach, expect, it, vi } from "vitest";

import {
  invalidInput,
  readWikiRequest,
  runWikiAction,
  succeeded,
  succeededWith,
  toWikiActionError,
} from "@/app/lib/wiki-actions/wiki-action-support.server";
import { ProjectAccessDeniedError } from "@/backend/error/ProjectErrors";
import {
  WikiAccessDeniedError,
  WikiConflictError,
  WikiPageNotFoundError,
  WikiValidationError,
} from "@/backend/error/WikiErrors";
import { InstanceSettingsDeniedError } from "@/backend/service/InstanceSettingsService";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { contextFor } from "../../server-lib/route-arguments";
import { thrownResponse } from "../../server-lib/request-fixtures";
import { storedPage, wikiContext } from "./wiki-action-fixtures";

import type { FormFields } from "../../actions/action-fixtures";

const boundary = vi.hoisted(() => ({ services: { wikiService: {} } }));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => boundary.services,
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function postRequest(fields: Readonly<Record<string, string>>): Request {
  return new Request("http://pages.invalid/wiki/page-1", {
    body: new URLSearchParams(fields),
    method: "POST",
  });
}

it("answers success with and without values for the client", async () => {
  expect((await outcomeOf(succeeded())).body).toEqual({ ok: true });
  expect((await outcomeOf(succeededWith({ cover: "c1" }))).body).toEqual({
    ok: true,
    cover: "c1",
  });
  expect(await outcomeOf(invalidInput())).toMatchObject({
    status: 400,
    body: { ok: false, error: "invalidInput" },
  });
});

it.each([
  ["a rule", new WikiValidationError("fileEmpty"), 400, "fileEmpty"],
  ["a missing page", new WikiPageNotFoundError(), 404, "notFound"],
  ["a denied page", new WikiAccessDeniedError(), 403, "forbidden"],
  ["a hidden project", new ProjectAccessDeniedError(), 403, "forbidden"],
  ["denied settings", new InstanceSettingsDeniedError(), 403, "forbidden"],
])("maps %s to %i", async (caseName, error, status, code) => {
  expect(await outcomeOf(toWikiActionError(error))).toMatchObject({
    status,
    body: { ok: false, error: code },
  });
});

it("hands the saved page back with a conflict", async () => {
  const current = storedPage();

  expect(
    await outcomeOf(toWikiActionError(new WikiConflictError(current))),
  ).toMatchObject({
    status: 409,
    body: { ok: false, error: "conflict", current },
  });
});

it("rethrows a failure that is none of the wiki failures", () => {
  const failure = new Error("disk full");

  expect(() => toWikiActionError(failure)).toThrow(failure);
});

it("reads the submission of a signed-in person", async () => {
  const context = await readWikiRequest(
    { request: postRequest({ intent: "save" }), context: contextFor(ACTOR) },
    "page-1",
  );

  expect(context.actor).toBe(ACTOR);
  expect(context.pageId).toBe("page-1");
  expect(context.services).toBe(boundary.services);
  expect(context.formData.get("intent")).toBe("save");
});

it("refuses anything but a POST", async () => {
  const response = await thrownResponse(
    readWikiRequest(
      {
        request: new Request("http://pages.invalid/wiki"),
        context: contextFor(ACTOR),
      },
      null,
    ),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
});

it("refuses a submission without a signed-in person", async () => {
  const response = await thrownResponse(
    readWikiRequest(
      { request: postRequest({ intent: "save" }), context: contextFor(null) },
      null,
    ),
  );

  expect(response.status).toBe(403);
});

it("runs the handler of the submitted intent", async () => {
  const save = vi.fn(async () => succeeded());

  const outcome = await outcomeOf(
    await runWikiAction({ save }, wikiContext({}, { intent: "save" })),
  );

  expect(save).toHaveBeenCalledOnce();
  expect(outcome.body).toEqual({ ok: true });
});

it.each<FormFields>([
  {},
  { intent: "unknown" },
  { intent: new File(["save"], "save") },
])("answers the intent of %j as invalid input", async (fields) => {
  const save = vi.fn(async () => succeeded());

  const outcome = await outcomeOf(
    await runWikiAction({ save }, wikiContext({}, fields)),
  );

  expect(outcome.status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});

it("turns a wiki failure of the handler into a response", async () => {
  const save = vi.fn(async () => Promise.reject(new WikiPageNotFoundError()));

  const outcome = await outcomeOf(
    await runWikiAction({ save }, wikiContext({}, { intent: "save" })),
  );

  expect(outcome).toMatchObject({
    status: 404,
    body: { ok: false, error: "notFound" },
  });
});
