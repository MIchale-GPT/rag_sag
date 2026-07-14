import { describe, expect, it } from "vitest";

import { planUniverseFocusCards } from "./universe-focus-cards";

const nodes = [
  { id: "event-a", kind: "event" as const, sourceId: "source-a" },
  { id: "entity-shared", kind: "entity" as const, sourceId: "source-a" },
  { id: "entity-b", kind: "entity" as const, sourceId: "source-a" },
  { id: "event-unrelated", kind: "event" as const, sourceId: "source-a" },
  { id: "entity-other-source", kind: "entity" as const, sourceId: "source-b" },
];

describe("universe focus card group", () => {
  it("shows one event and all of its direct entities as one group", () => {
    expect(planUniverseFocusCards(
      nodes,
      "event-a",
      ["entity-shared", "entity-b"],
      "source-a",
    )).toEqual({
      ids: ["event-a", "entity-shared", "entity-b"],
      eventCount: 1,
      entityCount: 2,
    });
  });

  it("shows one entity and its directly connected events without second-hop cards", () => {
    expect(planUniverseFocusCards(
      nodes,
      "entity-shared",
      ["event-a", "event-unrelated"],
      "source-a",
    )).toEqual({
      ids: ["event-a", "entity-shared", "event-unrelated"],
      eventCount: 2,
      entityCount: 1,
    });
  });

  it("deduplicates shared identities and never crosses sources", () => {
    expect(planUniverseFocusCards(
      [...nodes, nodes[1]],
      "event-a",
      ["entity-shared", "entity-shared", "entity-other-source"],
      "source-a",
    )).toEqual({
      ids: ["event-a", "entity-shared"],
      eventCount: 1,
      entityCount: 1,
    });
  });

  it("returns no forced group without a concrete focus", () => {
    expect(planUniverseFocusCards(nodes, null, [], "source-a"))
      .toEqual({ ids: [], eventCount: 0, entityCount: 0 });
  });

  it("does not render orphan neighbors when the focus is missing", () => {
    expect(planUniverseFocusCards(
      nodes,
      "missing-event",
      ["entity-shared", "entity-b"],
      "source-a",
    )).toEqual({ ids: [], eventCount: 0, entityCount: 0 });
  });
});
