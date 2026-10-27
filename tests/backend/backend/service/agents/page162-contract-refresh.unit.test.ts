import { expect, it } from "vitest";

import { buildPlanContract } from "@/backend/service/agents/AgentPlanContract";
import { refreshPlanContract } from "@/backend/service/agents/AgentPlanContractRefresh";

import { progressTicket } from "./page162-progress-fixture";

it("retains real item bindings and allocates unused report IDs after repeated removals and additions", () => {
  const first = buildPlanContract(
    "",
    [progressTicket("- [ ] First\n- [ ] Second\n- [ ] Third")],
    { isReadOnly: false, completion: "todos" },
  );
  const second = refreshPlanContract(
    "",
    first,
    [progressTicket("- [x] Second\n- [ ] Third")],
    { isReadOnly: false },
  );
  expect(second.todos.map((todo) => todo.id)).toEqual(["T2", "T3"]);
  const third = refreshPlanContract(
    "",
    second,
    [progressTicket("- [x] Second\n- [ ] Third\n- [ ] Fourth")],
    { isReadOnly: false },
  );
  expect(third.todos.map((todo) => todo.id)).toEqual(["T2", "T3", "T4"]);
  expect(third.todos.slice(0, 2).map((todo) => todo.ticket)).toEqual(
    second.todos.map((todo) => todo.ticket),
  );
  const recovered = refreshPlanContract(
    "",
    third,
    [progressTicket("- [ ] Fourth\n- [ ] Fifth")],
    { isReadOnly: false },
  );
  expect(recovered.todos.map((todo) => todo.id)).toEqual(["T4", "T5"]);
  expect(new Set(recovered.todos.map((todo) => todo.id)).size).toBe(2);
});

it("does not reuse a removed criterion's report ID while another retained criterion has that ID", () => {
  const criteria = ["first", "second", "third", "fourth"].map((id, index) => ({
    id,
    workItemId: "ticket",
    title: `${id} acceptance requirement`,
    isDone: false,
    sortOrder: index,
    createdAt: "2026-10-27T18:00:00Z",
    updatedAt: "2026-10-27T18:00:00Z",
  }));
  const first = buildPlanContract(
    "",
    [progressTicket("", "ticket", criteria.slice(0, 3))],
    { isReadOnly: false },
  );
  const second = refreshPlanContract(
    "",
    first,
    [progressTicket("", "ticket", criteria.slice(1, 3))],
    { isReadOnly: false },
  );
  expect(second.criteria.map((criterion) => criterion.id)).toEqual([
    "K2",
    "K3",
  ]);
  const updated = refreshPlanContract(
    "",
    second,
    [progressTicket("", "ticket", criteria.slice(1))],
    { isReadOnly: false },
  );
  expect(updated.criteria.map((criterion) => criterion.id)).toEqual([
    "K2",
    "K3",
    "K4",
  ]);
  expect(updated.criteria.at(-1)?.ticket?.itemId).toBe("ac-fourth");
});
