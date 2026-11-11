import {
  AUTOMATION_INTERVAL_SECONDS,
  AUTOMATION_LIST_LIMIT,
} from "@/definition/Automation";

import type { Automation, AutomationOptions } from "@/definition/Automation";

export const options: AutomationOptions = {
  triggers: [],
  actions: [],
  eventTypes: [],
  schemas: {},
  limits: {
    nameLength: 200,
    instructionLength: 20000,
    intervalSeconds: AUTOMATION_INTERVAL_SECONDS,
    answerBytes: 4096,
    forwardOutputBytes: 65536,
    runRetention: 50,
    list: AUTOMATION_LIST_LIMIT,
    script: {
      contentLength: 1000,
      timeoutSeconds: { minimum: 1, maximum: 60, initial: 30 },
      stdoutBytes: 100,
      stderrBytes: 100,
    },
  },
  timeZones: ["UTC"],
  defaultTimeZone: "UTC",
  agents: [{ id: "agent", name: "Agent", position: null }],
  plans: [
    {
      id: "blocked",
      name: "Blocked",
      projectName: null,
      canStart: false,
      steps: [],
    },
    { id: "plan", name: "Plan", projectName: null, canStart: true, steps: [] },
  ],
  projects: [{ id: "project", name: "Project", statuses: [] }],
  sharing: { projects: [], groups: [] },
  workspaces: [{ id: "workspace", name: "Workspace" }],
  interpreterProfiles: [{ id: "shell", name: "Shell" }],
  eventExamples: {
    "plan.started": {},
    "plan.succeeded": {},
    "plan.failed": {},
    "plan.step_changed": {},
    "ticket.created": {},
    "ticket.status_changed": {},
  },
};

export const now = new Date("2026-01-01T00:00:00Z");
export const automation: Automation = {
  id: "automation",
  revision: 4,
  creator: { accountId: "user", kind: "human", displayName: "User" },
  name: "Saved",
  trigger: { type: "manual" },
  action: { type: "agent", agentId: "agent", instruction: "Do it" },
  sharing: { scope: "private" },
  isActive: true,
  deleteAfterSuccess: false,
  agentNotification: { mode: "off" },
  nextRunAt: null,
  lastRun: null,
  permissions: { canRead: true, canEdit: true, canRun: true, canDelete: true },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
