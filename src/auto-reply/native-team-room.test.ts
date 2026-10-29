import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ResolvedGroupThreadConfig } from "./group-thread.types.js";
import {
  parseNativeTeamRoom,
  planNativeTeamRoomTurn,
  type NativeTeamRoom,
} from "./native-team-room.js";

const roomId = "11111111-1111-4111-8111-111111111111";
const roster = ["lead", "builder", "reviewer"];
const input = () => ({
  id: roomId,
  name: "Engineering",
  sectionId: "product",
  agentIds: [...roster],
  leadAgentId: "lead",
});
const room = () => parseNativeTeamRoom(input(), roster);
const plan = (value: NativeTeamRoom = room()) =>
  planNativeTeamRoomTurn({ room: value, rosterAgentIds: roster, requestId: "send-1" });

describe("native team room admission", () => {
  it("keeps stable room identity separate from editable labels and sections", () => {
    const original = room();
    const renamed = parseNativeTeamRoom({ ...input(), name: "Delivery", sectionId: "ops" }, roster);
    assert.equal(plan(original).peerId, plan(renamed).peerId);
    assert.equal(plan(original).messageId, "send-1");
    assert.equal(original.id, roomId);
  });

  it("trims names without changing canonical member identities", () => {
    const result = parseNativeTeamRoom({ ...input(), name: "  Engineering  " }, roster);
    assert.equal(result.name, "Engineering");
    assert.deepEqual(result.agentIds, roster);
  });

  it("rejects unknown members rather than silently substituting a default bot", () => {
    assert.throws(() => parseNativeTeamRoom({ ...input(), agentIds: ["lead", "missing"] }, roster), /Unknown room member/);
  });

  it("requires two to sixteen distinct participants and a member as lead", () => {
    assert.throws(() => parseNativeTeamRoom({ ...input(), agentIds: ["lead"] }, roster), /2 to 16/);
    assert.throws(() => parseNativeTeamRoom({ ...input(), agentIds: ["lead", "lead"] }, roster), /Duplicate room member/);
    assert.throws(() => parseNativeTeamRoom({ ...input(), leadAgentId: "outside" }, roster), /Lead must be a room member/);
    const tooMany = Array.from({ length: 17 }, (_, index) => `bot-${index}`);
    assert.throws(() => parseNativeTeamRoom({ ...input(), agentIds: tooMany, leadAgentId: tooMany[0] }, tooMany), /2 to 16/);
  });

  it("rejects malformed records and identity-bearing extra fields", () => {
    for (const value of [null, [], { ...input(), id: "Engineering" }, { ...input(), name: " " }, { ...input(), name: "x".repeat(81) }, { ...input(), sectionId: "bad\nsection" }, { ...input(), sessionKey: "agent:admin:main" }]) {
      assert.throws(() => parseNativeTeamRoom(value, roster));
    }
  });

  it("copies admitted member input so later input edits cannot mutate the room", () => {
    const request = input();
    const admitted = parseNativeTeamRoom(request, roster);
    request.agentIds.push("outside");
    assert.deepEqual(admitted.agentIds, roster);
  });
});

describe("native team room turn planning", () => {
  it("starts with only the lead while retaining the room for bounded follow-ups", () => {
    const result = plan();
    assert.deepEqual(result.mentionedAgentIds, ["lead"]);
    assert.deepEqual(result.group.agents, roster);
    assert.equal(result.group.mentionGating, true);
    assert.equal(result.group.maxRounds, 2);
    assert.equal(result.group.maxTurns, 6);
    const coordinatorConfig: ResolvedGroupThreadConfig = result.group;
    assert.equal(coordinatorConfig.strategy, "parallel");
  });

  it("asks every member only through the explicit everyone target", () => {
    const result = planNativeTeamRoomTurn({ room: room(), rosterAgentIds: roster, requestId: "send-2", target: { kind: "everyone" } });
    assert.deepEqual(result.mentionedAgentIds, roster);
  });

  it("routes structured mentions in room order, deduplicating repeated chips", () => {
    const result = planNativeTeamRoomTurn({ room: room(), rosterAgentIds: roster, requestId: "send-3", target: { kind: "agents", agentIds: ["reviewer", "builder", "reviewer"] } });
    assert.deepEqual(result.mentionedAgentIds, ["builder", "reviewer"]);
    assert.equal(result.group.configuredAgentCount, 3);
  });

  it("never converts an empty or invalid mention selection into broadcast", () => {
    for (const agentIds of [[], ["outside"], ["builder", "outside"]]) {
      assert.throws(() => planNativeTeamRoomTurn({ room: room(), rosterAgentIds: roster, requestId: "send-4", target: { kind: "agents", agentIds } }), /Select at least one|not a room member/);
    }
  });

  it("rechecks current roster before dispatch after a bot has been removed", () => {
    assert.throws(() => planNativeTeamRoomTurn({ room: room(), rosterAgentIds: ["lead", "builder"], requestId: "send-5" }), /Room member is no longer available/);
  });

  it("bounds work at the existing coordinator limits", () => {
    const agents = Array.from({ length: 16 }, (_, index) => `bot-${index}`);
    const largest = parseNativeTeamRoom({ ...input(), agentIds: agents, leadAgentId: agents[0] }, agents);
    const result = planNativeTeamRoomTurn({ room: largest, rosterAgentIds: agents, requestId: "send-6" });
    assert.equal(result.group.maxTurns, 32);
    assert.equal(result.group.maxRounds, 2);
  });

  it("keeps two rooms distinct even when their labels and participants match", () => {
    const other = parseNativeTeamRoom({ ...input(), id: "22222222-2222-4222-8222-222222222222" }, roster);
    assert.notEqual(plan().peerId, plan(other).peerId);
  });

  it("requires a bounded caller request ID without inventing delivery guarantees", () => {
    for (const requestId of ["", " ", "x\ny", "x".repeat(129)]) {
      assert.throws(() => planNativeTeamRoomTurn({ room: room(), rosterAgentIds: roster, requestId }), /requestId/);
    }
    assert.throws(() => planNativeTeamRoomTurn({
      room: room(),
      rosterAgentIds: roster,
      // @ts-expect-error Runtime callers must not get identifier coercion.
      requestId: 42,
    }), /requestId/);
    assert.deepEqual(plan(), plan());
  });
});
