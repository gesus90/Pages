import { describe, expect, it, vi } from "vitest";

import { OpenRouterDecisionsClient } from "@/backend/service/conversation/OpenRouterDecisionsClient";

import type { OpenRouterDecisionsRequest } from "@/backend/service/conversation/OpenRouterDecisionsClient";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const request: OpenRouterDecisionsRequest = {
  apiKey: "or-secret-key",
  model: "perplexity/pplx-decider-v1.3",
  state: { neue_nachricht: "Danke!" },
  questions: {
    answer_expected: {
      type: "noul",
      instructions: "Erwartet sie eine Antwort?",
    },
    agent_meant: {
      type: "choice",
      instructions: "Welcher Agent?",
      criteria: { ed: "Ed", "(niemand)": "Niemand" },
    },
  },
};

const GOOD_BODY = {
  id: "gen-dec-1",
  model: "perplexity/pplx-decider-v1.3-20261112",
  provider: "Perplexity",
  answers: {
    answer_expected: { type: "noul", noul: 0.06 },
    agent_meant: {
      type: "choice",
      choice: "(niemand)",
      probabilities: { ed: 0.09, "(niemand)": 0.91 },
      confidence: 0.91,
    },
  },
  usage: { input_tokens: 80, output_tokens: 0, cost: 0 },
};

function respond(
  body: unknown,
  init: ResponseInit = { status: 200 },
): typeof fetch {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(typeof body === "string" ? body : JSON.stringify(body), init),
    );
}

describe("OpenRouterDecisionsClient", () => {
  it("posts model, state and typed questions to the decisions interface, not to the chat endpoint", async () => {
    const transport = respond(GOOD_BODY);
    const response = await new OpenRouterDecisionsClient(transport).decide(
      request,
    );
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(transport).mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer or-secret-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: request.model,
      state: request.state,
      questions: request.questions,
    });
    expect(response).toEqual({
      model: "perplexity/pplx-decider-v1.3-20261112",
      answers: {
        answer_expected: { type: "noul", noul: 0.06 },
        agent_meant: {
          type: "choice",
          choice: "(niemand)",
          probabilities: { ed: 0.09, "(niemand)": 0.91 },
        },
      },
    });
  });

  it("keeps a choice without probabilities as one without", async () => {
    const body = {
      ...GOOD_BODY,
      answers: {
        ...GOOD_BODY.answers,
        agent_meant: { type: "choice", choice: "ed" },
      },
    };
    const response = await new OpenRouterDecisionsClient(respond(body)).decide(
      request,
    );
    expect(response.answers.agent_meant).toEqual({
      type: "choice",
      choice: "ed",
      probabilities: null,
    });
  });

  it.each([401, 402, 429, 500, 502, 524])(
    "reports HTTP %i as a failed call",
    async (status) => {
      await expect(
        new OpenRouterDecisionsClient(
          respond("secret error text", { status }),
        ).decide(request),
      ).rejects.toMatchObject({ code: "decision_failed" });
    },
  );

  it("reports a network failure as unreachable", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      new OpenRouterDecisionsClient(transport).decide(request),
    ).rejects.toMatchObject({ code: "decision_unreachable" });
  });

  it.each([
    ["no JSON", "not json"],
    [
      "a probability above 1",
      {
        ...GOOD_BODY,
        answers: { answer_expected: { type: "noul", noul: 1.5 } },
      },
    ],
    [
      "an unknown answer type",
      {
        ...GOOD_BODY,
        answers: { answer_expected: { type: "score", score: 1 } },
      },
    ],
    ["no model", { answers: GOOD_BODY.answers }],
  ])("refuses an answer with %s as invalid", async (_name, body) => {
    await expect(
      new OpenRouterDecisionsClient(respond(body)).decide(request),
    ).rejects.toMatchObject({ code: "decision_invalid" });
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation(() => {
      controller.abort(new Error("cancelled"));
      return Promise.reject(new TypeError("aborted"));
    });
    await expect(
      new OpenRouterDecisionsClient(transport).decide({
        ...request,
        signal: controller.signal,
      }),
    ).rejects.toThrow("cancelled");
  });
});
