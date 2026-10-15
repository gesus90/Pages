import { describe, expect, it } from "vitest";

import {
  readAgentTicketRead,
  readAgentTicketReference,
  resolveAgentTicketReference,
} from "@/backend/service/agents/AgentTicketValidation";

import { expectInvalidRequest } from "./operation-error-expectation";

describe("resolveAgentTicketReference", () => {
  it.each([
    ["PAGE-12", { key: "PAGE-12" }],
    ["page-12", { key: "PAGE-12" }],
    ["  PAGE-12\n", { key: "PAGE-12" }],
    ["PROJ2-5", { key: "PROJ2-5" }],
    ["/tasks/PAGE-12", { key: "PAGE-12" }],
    ["/aufgaben/page-7", { key: "PAGE-7" }],
    ["/prefix/tasks/PAGE-12/", { key: "PAGE-12" }],
    ["https://pages.test/tasks/PAGE-12?tab=1#c", { key: "PAGE-12" }],
    ["http://localhost:3000/aufgaben/PAGE-3", { key: "PAGE-3" }],
  ])("reads the key of %j", (reference, expected) => {
    expect(resolveAgentTicketReference(reference)).toEqual(expected);
  });

  it.each([
    "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "ticket_1",
    "PAGE-12x",
    "1ABC-5",
  ])("treats %j as an identifier", (reference) => {
    expect(resolveAgentTicketReference(reference)).toEqual({ id: reference });
  });

  it.each([
    ["an empty text", ""],
    ["a blank text", "   "],
    ["text with spaces", "PAGE 12"],
    ["a title-like text", "Fix the login!"],
    ["an address without a key", "/tasks/12"],
    ["an address with an extra path", "/tasks/PAGE-12/comments"],
    ["a wiki address", "/wiki/abc"],
  ])("returns null for %s", (_, reference) => {
    expect(resolveAgentTicketReference(reference)).toBeNull();
  });
});

describe("readAgentTicketReference", () => {
  it("accepts keys, addresses and identifiers", () => {
    expect(readAgentTicketReference("page-9")).toEqual({ key: "PAGE-9" });
    expect(readAgentTicketReference("abc-def")).toEqual({ id: "abc-def" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 12],
    ["an object", { key: "PAGE-1" }],
    ["an empty text", ""],
    ["an overlong text", "a".repeat(201)],
    ["a text that names no ticket", "not a ticket!"],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readAgentTicketReference(input));
  });

  it("accepts an identifier of exactly 200 characters", () => {
    const id = "a".repeat(200);
    expect(readAgentTicketReference(id)).toEqual({ id });
  });
});

describe("readAgentTicketRead", () => {
  it("returns the reference of the ticket", () => {
    expect(readAgentTicketRead({ ticketId: "PAGE-1" })).toEqual({
      key: "PAGE-1",
    });
  });

  it.each([
    ["no parameters", {}],
    ["an unknown parameter", { ticketId: "PAGE-1", extra: true }],
    ["an array", ["PAGE-1"]],
    ["null", null],
    ["a string", "PAGE-1"],
    ["a malformed reference", { ticketId: 4 }],
  ])("refuses %s", (_, input) => {
    expectInvalidRequest(() => readAgentTicketRead(input));
  });
});
