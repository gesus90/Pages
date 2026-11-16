import { afterEach, expect, it, vi } from "vitest";

import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentIdentity } from "@/definition/McpAuthorization";

const identity = partial<AgentIdentity>({ userId: "user" });
afterEach(() => vi.useRealTimers());

it("issues single-use capabilities and rechecks their original owner", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100000);
  const verify = vi.fn(async () => identity);
  const service = new AgentUploadTicketService(verify);
  const issued = service.issue("secret", "user", "report.txt", "ticket-id");
  expect(issued.expiresAt).toBe(400000);
  const result = await service.consume(issued.ticket);
  expect(result).toMatchObject({
    fileName: "report.txt",
    ticketId: "ticket-id",
  });
  expect(verify).toHaveBeenCalledWith(
    expect.not.stringContaining("secret"),
    100000,
  );
  await expect(result.revalidate()).resolves.toBe(identity);
  await expect(service.consume(issued.ticket)).rejects.toThrow();
});

it("rejects expired or reassigned credentials without allowing replay", async () => {
  vi.useFakeTimers();
  const verify = vi.fn(async () => partial<AgentIdentity>({ userId: "other" }));
  const service = new AgentUploadTicketService(verify);
  const expired = service.issue("secret", "user", "file", { pageId: "page" });
  await vi.advanceTimersByTimeAsync(300000);
  await expect(service.consume(expired.ticket)).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
  const reassigned = service.issue("secret", "user", "file", {
    pageId: "page",
  });
  await expect(service.consume(reassigned.ticket)).rejects.toThrow();
  await expect(service.consume(reassigned.ticket)).rejects.toThrow();
  expect(verify).toHaveBeenCalledOnce();
});
