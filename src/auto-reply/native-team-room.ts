/** Metadata only: display sections never grant access to agents or their sessions. */
export type NativeTeamRoom = {
  id: string;
  name: string;
  sectionId: string | null;
  agentIds: readonly string[];
  leadAgentId: string;
};

/** Mention chips carry roster IDs; names in message text are not routing authority. */
export type NativeTeamRoomTarget =
  | { kind: "lead" }
  | { kind: "everyone" }
  | { kind: "agents"; agentIds: readonly string[] };

const ROOM_KEYS = new Set(["id", "name", "sectionId", "agentIds", "leadAgentId"]);
const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECTION_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Admit a room record at the boundary against a host-provided, canonical roster. */
export function parseNativeTeamRoom(
  value: unknown,
  rosterAgentIds: readonly string[],
): NativeTeamRoom {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Room must be an object");
  }
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ROOM_KEYS.has(key)) {
      throw new Error(`Unknown room field: ${key}`);
    }
  }
  if (typeof input.id !== "string" || !ROOM_ID.test(input.id)) {
    throw new Error("Room id must be a canonical UUID, not a display name");
  }
  if (
    typeof input.name !== "string" ||
    input.name.trim().length === 0 ||
    input.name.trim().length > 80 ||
    CONTROL_CHARACTERS.test(input.name)
  ) {
    throw new Error("Room name must contain 1 to 80 characters without control characters");
  }
  const sectionId = input.sectionId ?? null;
  if (sectionId !== null && (typeof sectionId !== "string" || !SECTION_ID.test(sectionId))) {
    throw new Error("Room sectionId must be a canonical section ID or null");
  }
  if (!Array.isArray(input.agentIds) || input.agentIds.length < 2 || input.agentIds.length > 16) {
    throw new Error("Room must contain 2 to 16 distinct agents");
  }
  const roster = new Set(rosterAgentIds);
  const members = new Set<string>();
  for (const agentId of input.agentIds) {
    if (typeof agentId !== "string" || !roster.has(agentId)) {
      throw new Error("Unknown room member; choose an agent from the current roster");
    }
    if (members.has(agentId)) {
      throw new Error(`Duplicate room member: ${agentId}`);
    }
    members.add(agentId);
  }
  if (typeof input.leadAgentId !== "string" || !members.has(input.leadAgentId)) {
    throw new Error("Lead must be a room member");
  }
  return {
    id: input.id,
    name: input.name.trim(),
    sectionId,
    agentIds: [...members],
    leadAgentId: input.leadAgentId,
  };
}

/**
 * Prepare the existing runGroupThread contract; do not start a second coordinator.
 * This is routing, not authorization, durable deduplication, or execution. The
 * caller must bind the authenticated request, derive participant session keys
 * through the existing route owner, and retain the normal dispatch lifecycle.
 */
export function planNativeTeamRoomTurn(params: {
  room: NativeTeamRoom;
  rosterAgentIds: readonly string[];
  requestId: string;
  target?: NativeTeamRoomTarget;
}) {
  const { room } = params;
  if (typeof params.requestId !== "string" || !REQUEST_ID.test(params.requestId)) {
    throw new Error("requestId must be 1 to 128 canonical identifier characters");
  }
  const roster = new Set(params.rosterAgentIds);
  for (const agentId of room.agentIds) {
    if (!roster.has(agentId)) {
      throw new Error(`Room member is no longer available: ${agentId}; update room membership`);
    }
  }
  const target = params.target ?? { kind: "lead" };
  let mentionedAgentIds: string[];
  switch (target.kind) {
    case "lead":
      mentionedAgentIds = [room.leadAgentId];
      break;
    case "everyone":
      mentionedAgentIds = [...room.agentIds];
      break;
    case "agents": {
      if (target.agentIds.length === 0) {
        throw new Error("Select at least one room member for a targeted message");
      }
      const selected = new Set(target.agentIds);
      for (const agentId of selected) {
        if (!room.agentIds.includes(agentId)) {
          throw new Error(`Target is not a room member: ${agentId}`);
        }
      }
      mentionedAgentIds = room.agentIds.filter((agentId) => selected.has(agentId));
      break;
    }
    default:
      throw new Error("Unknown room target");
  }
  return {
    peerId: `native-team:${room.id}`,
    messageId: params.requestId,
    // An empty list means broadcast to the existing coordinator. Never emit it
    // for an invalid/empty mention selection or a room whose lead was removed.
    mentionedAgentIds,
    group: {
      agents: [...room.agentIds],
      unknownAgentIds: [] as string[],
      qualified: true,
      configuredAgentCount: room.agentIds.length,
      mentionGating: true,
      maxRounds: 2,
      maxTurns: room.agentIds.length * 2,
      strategy: "parallel" as const,
    },
  };
}
