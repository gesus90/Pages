# PAGE-296: Group observer, agent hand-over and shared group context

Agents take part in Pages groups like responsible team members. A person
addresses them with `@`, or a central observer chooses them by their stated
responsibility. Agents can hand a round over to other agents. The observer
also keeps one stored context per group.

## Answers in conversations

`ConversationAgentReplies` decides who answers, `ConversationReplyRunner`
runs one answer as the agent's own account (model, instructions, rights;
`AgentConversationAnswers` and `AgentEmployeeSessions` unchanged).

| Message                               | Who answers                                 | Observer call |
| ------------------------------------- | ------------------------------------------- | ------------- |
| Person, direct conversation           | the agent partner (`direct`)                | none          |
| Person, group, agent mentioned with @ | every mentioned agent at once (`mention`)   | none          |
| Person, group, no agent mentioned     | the agents the observer chooses (`context`) | exactly one   |
| Agent answer that mentions agents     | the mentioned agents (`handoff`)            | none          |
| Agent answer without agent mention    | the agents the observer chooses (`handoff`) | exactly one   |
| Hint of Pages, summary update         | nobody                                      | none          |

Mentions of an answer are found with `findConversationMentions` exactly like
those of a person and stored with the message.

Every answer belongs to the round of the person's message that opened it
(`conversation_reply_rounds`). The limits live in one place,
`CONVERSATION_OBSERVER_LIMITS` in `definition/ConversationObserver.ts`:

- at most three automatic answers (`context`, `handoff`) per round; agents
  the person mentioned are not counted and never cut off;
- every agent answers a round once (`conversation_reply_targets`, primary key
  round + agent, plus the client message ID `reply-<origin>` of the answer);
- at most one routing decision per message (`conversation_observer_routings`,
  primary key = judged message).

A claim locks its round row, so concurrent jobs, repeated events and a
restart neither ask an agent twice nor exceed the limit. The state of an
answer is `answered` only with a stored answer; a hint is `failed`. At start
the background process marks answers and decisions an earlier process left
open as `interrupted`/`failed` and starts none of them again.

Before an answer starts, the agent must still be an active member. The prompt
names the real reason (direct, mention, responsibility with the observer's
reason, hand-over with its reason and the round's message) and states that a
choice by Pages or another agent is no order and adds no right: writing
actions need an explicit request of the person, and the agent's own account
rights apply as before.

## The observer

`ConversationObserverModel` resolves Pica's current choice for every call
through `PicaSettingsService.resolve` for the person whose content causes the
call, and checks it again with `requireCurrent` right before the session
starts. There is no fallback model and no stand-in person; Pica off, a
missing choice or a person outside the connection scope means no call
(`pica_disabled`, `pica_model_missing`, `pica_access_denied`, …).

The call runs apart from Pica's chat: no chat session, no memory, no
`SOUL.md`, no tools. It opens a short ACP session of the new purpose
`observer` on the plan execution path in an empty private directory below
`observer-sessions` next to Pica's working directories (PAGE-340: the worker
unit does not see a private `/tmp` of the Pages service), read-only, without web, shell or MCP server, with a five-minute deadline.
Every driver maps `observer` to a profile without tools (Codex: read-only,
shell/apps/web off, every request refused; Claude Code: `tools: []`, no
session kept; Antigravity: `enabledTools: []`, no MCP server; OpenCode: the
tool-free decision agent). Pica's run mode is never adopted.

The routing material is the bounded history of this group (20 messages,
12,000 characters), its stored context and the active agent members with ID,
name, username and job title. The answer must be exactly
`{"agents":[{"id":"…","reason":"…"}]}` with known IDs; anything else is
`observer_output_invalid` and starts nobody. An empty list is silence.

Each call is stored in `conversation_observer_runs` with kind, trigger,
person, connection, model, outcome and the token usage the ACP adapter
reported, apart from the agents' own usage. No prompt and no answer is
stored or logged. Nothing is retried at once.

## Group context

`conversation_group_contexts` holds one context per group: summary,
decisions, open points, responsibilities, sources (sequence ranges with the
message IDs of the newest windows), `through_sequence`, a fingerprint of the
summarized messages, status and error code. It is private data of the group
and is deleted with it.

`ConversationGroupSummaryScheduler` runs in the Pages process that serves the
chat (not in the runs or local-session process), every five minutes, without
a browser and without an operating-system job. Only groups with an active
agent member and content messages after `through_sequence` are summarized;
an unchanged group costs no call. A window holds at most 20 messages and
12,000 characters of text, long messages enter as marked excerpts of 2,000
characters, and the previous context (at most 6,000 characters) is added. A
window ends before a voice message whose text is still being recognized, so
the sequence never passes an unread message. Three windows per group and tick
at most; a longer backlog stays `behind`. A new summary over 6,000 characters
is rejected, never cut. A failed attempt keeps the previous summary, records
the code and waits 30 minutes.

When a summarized message changes or vanishes (fingerprint check at every
read, at every tick and on `message_updated`), the summary is no longer
served and is built anew from the remaining messages.

Agents get the valid summary with its sequence and moment plus only the
messages after it up to the trigger; a cut backlog is named together with
`read_conversation_context`. That tool is offered to agent jobs over the
existing Pica bridge (`PicaEmployeeTools`). It reads only groups the agent's
own account is an active member of, checked at every read, and returns at
most 20 messages and 12,000 characters after a cursor.

The web chat page shows a „Gruppenkontext“ dialog in the group header, read
on opening through the `group-context` intent, for members only. Summaries
are never posted as messages, so they cause no push, unread count or answer.
Pica Mobile keeps receiving group messages and answers over the existing
`conversations.v1` service; no protocol change.

## Not verified here

The functional check ran with the agent simulation (`PAGES_AGENT_SIMULATION=1`)
on an isolated instance: Pica's real resolver and connection scope were used,
the model answer itself was simulated. The quality of real routing and
summaries with the chosen Pica model and the behaviour of the four CLI
runners in the `observer` profile need the operator check after deployment.
