---
summary: "Draft design and implementation gates for native human-and-agent team rooms"
read_when:
  - Implementing native agent team rooms in the Control UI
  - Reviewing the native team room routing foundation
status: draft
title: "Native agent teams"
---

# Native agent teams

## Status and outcome

This is a draft implementation kickoff, not an installed chat feature. This
change adds the room-admission and reply-target planning module plus tests.
There is **no registered tab, Gateway method, durable room store, or live agent
execution path yet**. The planner has no production caller until the next slice.
Do not enable a decorative tab that cannot send messages or claim this is a
working multi-agent product.

The intended outcome is one native OpenClaw workspace where a person can organize
bots into sections, create multiple teams, and work with several agents in a
shared conversation. No Slack, Discord, external chat server, or ClawSwarm.

## Source baseline and decisions

Implementation baseline: `openclaw/openclaw` commit
`48f40fb0a2f328a4f364767a232786411ad82997`, inspected October 28, 2026
(America/Chicago). The branch is based on that upstream commit rather than the
older default branch of the development fork.

- `src/auto-reply/group-thread.ts` already owns participant turn reservations,
  follow-up digests, silence, cancellation, and bounded rounds. Reuse it; do not
  add a second agent scheduler. `group-thread-context.ts` owns attributed replies
  and root adoption.
- `docs/channels/broadcast-groups.md` documents the same limits: at most 16
  participants, 4 rounds, and 32 participant starts. Its active round state is
  in-memory. Persistent chat history is not restart-safe execution.
- `docs/plugins/sdk-overview/host-hooks.md` permits Control UI tabs. A bundled
  plugin with a matching native route can use native placement. An external
  plugin frame has a read-only HTTP grant; it is not a general authenticated
  mutation bridge. Do not pass Gateway credentials into an iframe to work around
  that limitation.
- `ui/AGENTS.md` requires Solid 2, existing UI tokens, lazy native routes, and
  Gateway-owned shared state. Follow those contracts instead of introducing a
  React app or replacing the existing shell.
- Hermes interaction reference:
  `NousResearch/hermes-agent` at
  `83bde48a4d9760d84220a9b29094a1ad86410f6e`,
  `apps/desktop/src/plugins/hermes-bots/group-chat.ts`, and its Bot Mode guide.
  Reuse the interaction idea, not its separate storage/mirroring implementation
  or copied source. A room's identity must survive renames and moves.

The current group coordinator is an internal core module, not a verified public
plugin SDK entrypoint. A plugin **must not import it privately**. Implement the
native ingress adapter beside its existing core owner. If a public host seam is
needed, review one narrow generic contract and its real consumer together; do
not invent an unofficial SDK export in plugin code.

## Product layout

Use the existing OpenClaw shell and a native Teams surface, not another launcher.

```text
Teams                 Engineering                           Members / details
  Engineering         Lead · Builder · Reviewer              (collapsed normally)
  Research
  Operations          Person: investigate this issue         Current work
                      Lead: scope + assignment               Needs your input
Bots                  Builder: findings + artifact           Linked session / PR
  Engineering         Reviewer: verification                 Room settings
    Lead
    Builder           [Reply to Lead | @members | Everyone]
    Reviewer          [Message the team ...]          [Send]
  Research
    Researcher
```

The message pane is the primary surface. Bot sections are collapsible navigation,
not a wall of cards. Each bot can also open its ordinary direct session. A bot's
section is presentation metadata, not a permission group. Moving a bot between
sections does not delete it, change its tools, or move private conversations.

Room replies display the actual agent identity, recipient chips, timestamp, and
links to native work. Tool activity is expandable underneath the relevant reply.
Never present one model playing several roles as several independent agents.
Native approval and clarification requests must appear as actionable cards and
an accurate needs-you badge, including when the underlying member session is
not the selected page. No fabricated online/busy/completed states.

Use existing light/dark theme tokens, native controls, keyboard navigation,
visible focus, a labelled composer, and accessible mention selection. Narrow
windows collapse navigation and the inspector rather than shrinking the message
column into unreadability. Preserve per-room drafts when navigating. Threaded
work can be expanded from a room; its canonical task/run remains host-owned.

## First slice: explicit room and turn plans

Implemented in `src/auto-reply/native-team-room.ts`:

- `parseNativeTeamRoom(value, rosterAgentIds)` admits a strict metadata record:
  immutable canonical UUID, editable name, optional section ID, 2–16 distinct
  registered members, and one member designated as lead. The host provides the
  canonical roster; a browser-supplied list is not authority.
- `planNativeTeamRoomTurn({ room, rosterAgentIds, requestId, target })` accepts an
  admitted room and produces the existing group-thread configuration, a stable
  peer ID, the caller request ID, and explicit initial participant IDs.
- Default target is the lead. `everyone` is an explicit user choice. `agents`
  carries canonical roster IDs from mention chips, preserves room order, and
  rejects empty or non-member selections. In particular, an invalid mention
  must not become an empty list, which the coordinator interprets as fan-out.
- Initial policy is two rounds and twice the member count in participant starts
  (at most 32). The existing coordinator remains responsible for reserving starts
  before launch, collecting attributed finals, and stopping. A start budget is
  not a dollar budget, a tool-call limit, or a guarantee that all work completed.
- Removing a configured agent between room creation and send yields an explicit
  membership error instead of silently substituting another agent.

This module does not authorize a caller, allocate sessions, persist messages,
start agents, guarantee idempotency, or recover interrupted work. Its return
value is a plan, never an execution receipt. It must not become a model-facing
tool or a client authority token.

## Next implementation slices and acceptance gates

### 1. Durable room owner and authorized native ingress

- [ ] Add the plugin-owned room catalog using the existing asynchronous SQLite
  state owner; read database worker rules and review the persistence boundary
  before changing schemas. Do not add JSON files, browser-local authoritative
  history, or a separate server. Names/sections and membership remain metadata.
- [ ] Add request schemas and native Gateway handlers beside the current request
  admission owner. Bind the actual authenticated profile, requester, and current
  session access. Use host-derived identities, not browser-supplied session keys,
  sender names, account IDs, or privilege flags. Read and write scopes alone do
  not replace per-room and per-session authorization.
- [ ] Use the existing route owner to derive stable, isolated member sessions.
  Feed the plan into `runGroupThread` through normal admitted dispatch. Preserve
  root adoption, current-authority checks, approval handling, and cancellation.
- [ ] Store public room messages and native run/session references. Never copy a
  member's private direct-chat history into the room. Append bounded shared-room
  context without rewriting past member-session history or stable prompts.
- [ ] Persist send acceptance and reconcile canonical native run receipts. A
  retry with the same identity must not start duplicate work. After restart,
  unproven in-flight work is `interrupted`/unknown, not completed and not silently
  replayed. Use existing host idempotency/custody where available, not a second
  distributed task engine.

Gate: a real Gateway request from a permitted person reaches two configured
agents, one sees the other's attributed result in a follow-up, and public output
returns to the same room. Tests must reject a non-member, cross-profile access,
forged session routing, revoked authority, and repeated send delivery. A helper
unit test alone does not satisfy this gate.

### 2. Native Teams UI

- [ ] Add the bundled plugin descriptor and matching lazy Solid route together.
  Register neither a broken tab nor an external-frame credential workaround.
- [ ] Bind roster, sections, room list, transcript, composer, and member details
  to the Gateway owner. Surface loading, disconnected, empty, failed, and
  interrupted states. Mutations need an acknowledged outcome and visible retry.
- [ ] Wire mention chips to canonical member IDs and display the selected reply
  target before send. Choosing no valid target cannot imply everyone.
- [ ] Surface native agent activity, asks/approvals, pause/stop, and real artifact
  links. Refresh/reconnect must not change the selected room or restart work.
- [ ] Scope event updates and caches by connection, profile, room, and session.
  Use the existing paced reconciliation owners; do not refetch the entire roster
  per token/event or poll every agent independently.

Gate: native browser tests cover create room, rename/move without history loss,
switch rooms with drafts, targeted send, everyone send, approval answer, stop,
reconnect, membership edit, and unknown/error outcomes. Inspect sanitized
before/after screenshots in both themes and a narrow window. Run i18n, UI build,
style, accessibility, and performance checks before marking the UI complete.

### 3. Real collaboration proof and rollout

- [ ] Run an isolated Gateway with three real configured agents and a permitted
  model: research/build/review one bounded task. Verify independent session/run
  IDs, sibling context, actual output, and a checkable artifact, not role labels.
- [ ] Exercise all-silent, agent failure, slow provider, cancellation, restart,
  duplicate delivery, deleted member, and an unanswered approval. None may create
  unbounded conversations, duplicate effects, or false completion.
- [ ] Keep existing direct chats and external channel group-thread tests green.
  Run normal repository typecheck, format/lint, focused tests, and applicable
  integration suites. No baseline/limit increases to hide failures.
- [ ] Keep the change opt-in and unreleased until those gates pass. No automatic
  installation, live Gateway restart, external notifications, or production data
  mutation is part of this draft.

First release scope is multiple rooms and agents on **one Gateway**. Multiple
machines/Gateways need an explicit authenticated relay and one room authority;
listing remote bots is not proof they can participate. Do not promise federation
from the initial single-Gateway planner.

## Verification recorded for this draft

The canonical added tests use Vitest (`native-team-room.test.ts`). This editing
environment has Node and TypeScript but cannot clone/install dependencies from
GitHub, so the repository Vitest runner and full build were **not run**.

Executed evidence:

1. With placeholder implementations, the same 14 test bodies produced 13
   failures and 1 pass. This is a new-feature red baseline, not a reproduction of
   an existing production bug.
2. With the implementation, all 14 passed in a Node test compatibility harness.
   The temporary loader maps only `vitest`'s `describe`/`it` imports to `node:test`
   and local `.js` source references to `.ts`; assertions and production module
   are unchanged. This does not establish Vitest or repository CI passing.
3. Standalone strict TypeScript checking of the new production module passed.
   This is not a whole-repository typecheck.

Canonical follow-up command from a full checkout:

```bash
node scripts/run-vitest.mjs run --config test/vitest/vitest.unit.config.ts \
  src/auto-reply/native-team-room.test.ts
```

No live agent/model call, durable storage test, native UI build, screenshot, or
end-to-end collaboration test has been performed for this draft. Those are
explicit remaining gates, not implied by the passing planner tests.
