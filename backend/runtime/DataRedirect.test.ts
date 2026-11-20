import { expect, it } from "vitest";

import { answerDataRedirect } from "./DataRedirect";

function dataRequest(): Request {
  return new Request("http://pages.test/a.data", {
    headers: { "X-Pages-Data-Request": "1" },
  });
}

it("returns the response unchanged when the request is no data request", () => {
  const response = new Response(null, {
    status: 302,
    headers: { Location: "/next" },
  });

  const answer = answerDataRedirect(
    new Request("http://pages.test/a"),
    response,
  );

  expect(answer).toBe(response);
  expect(answer.status).toBe(302);
});

it("returns a non-redirect answer to a data request unchanged", () => {
  const response = new Response("ok", {
    status: 200,
    headers: { Location: "/ignored" },
  });

  expect(answerDataRedirect(dataRequest(), response)).toBe(response);
});

it("returns a redirect status without a Location unchanged", () => {
  const response = new Response(null, { status: 302 });

  expect(answerDataRedirect(dataRequest(), response)).toBe(response);
});

it.each([301, 302, 303, 307, 308])(
  "turns a %i redirect into 204 with the target in a header",
  (status) => {
    const response = new Response(null, {
      status,
      headers: { Location: "/login", "X-Other": "kept" },
    });

    const answer = answerDataRedirect(dataRequest(), response);

    expect(answer.status).toBe(204);
    expect(answer.headers.get("X-Pages-Redirect")).toBe("/login");
    expect(answer.headers.get("Location")).toBeNull();
    expect(answer.headers.get("Cache-Control")).toBe("no-store");
    expect(answer.headers.get("X-Other")).toBe("kept");
  },
);

it("keeps every Set-Cookie of the redirect", () => {
  const headers = new Headers({ Location: "/home" });
  headers.append("Set-Cookie", "a=1");
  headers.append("Set-Cookie", "b=2");

  const answer = answerDataRedirect(
    dataRequest(),
    new Response(null, { status: 303, headers }),
  );

  expect(answer.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
});
