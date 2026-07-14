import { describe, expect, it } from "vitest";

import {
  replaceUniverseWorkingSet,
  type UniverseWorkingNode,
} from "./universe-working-set";
import {
  DEFAULT_UNIVERSE_VIEW_PREFERENCES,
  UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY,
  UNIVERSE_VIEW_LIMITS,
  effectiveUniverseBundleWindow,
  effectiveUniverseBudget,
  loadUniverseEntityCategories,
  loadUniverseViewPreferences,
  minimumUniverseCacheBundles,
  normalizeUniverseViewPreferences,
  projectUniverseWorkingSet,
  publishUniverseEntityCategories,
  universeCardBudget,
  type UniverseViewPreferences,
} from "./universe-view-preferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function preferences(
  patch: Partial<UniverseViewPreferences> = {},
): UniverseViewPreferences {
  return normalizeUniverseViewPreferences({
    ...DEFAULT_UNIVERSE_VIEW_PREFERENCES,
    ...patch,
  });
}

function node(
  id: string,
  kind: "event" | "entity",
  category = "",
): UniverseWorkingNode {
  return {
    id,
    kind,
    source_id: "source-a",
    label: id,
    category,
    touched_at: 1,
    root: true,
  };
}

function workingSet() {
  return replaceUniverseWorkingSet({
    epoch: 7,
    query: "projection",
    nodes: [
      node("event-1", "event"),
      node("person-1", "entity", "Person"),
      node("event-2", "event"),
      node("org-1", "entity", "Organization"),
    ],
    relations: [
      {
        source_id: "source-a",
        from_id: "event-1",
        to_id: "person-1",
        kind: "mentions",
        weight: 1,
        description: "",
      },
      {
        source_id: "source-a",
        from_id: "event-2",
        to_id: "org-1",
        kind: "mentions",
        weight: 1,
        description: "",
      },
      {
        source_id: "source-a",
        from_id: "event-1",
        to_id: "event-2",
        kind: "subevent",
        weight: 1,
        description: "",
      },
    ],
  }, { nodes: 100, edges: 100 }, 1);
}

describe("universe view preference normalization", () => {
  it("repairs untrusted values inside the strict v5 schema", () => {
    expect(normalizeUniverseViewPreferences({
      version: 5,
      visibleEventBundles: 99.9,
      cachedEventBundles: -100,
      showEventCards: "yes",
      showEntityCards: false,
      entityCategories: [" Person ", "", "Person", 42],
      visibleKinds: ["entity"],
      priority: "events",
    })).toEqual({
      version: 5,
      visibleEventBundles: 18,
      cachedEventBundles: 36,
      showEventCards: true,
      showEntityCards: false,
      entityCategories: ["Person"],
    });
  });

  it("enables both card kinds by default and permits both to be disabled", () => {
    expect(DEFAULT_UNIVERSE_VIEW_PREFERENCES.showEventCards).toBe(true);
    expect(DEFAULT_UNIVERSE_VIEW_PREFERENCES.showEntityCards).toBe(true);
    expect(preferences({
      showEventCards: false,
      showEntityCards: false,
    })).toMatchObject({
      showEventCards: false,
      showEntityCards: false,
    });
  });

  it("exposes the production window and cache ranges", () => {
    expect(UNIVERSE_VIEW_LIMITS.visibleEventBundles).toMatchObject({
      min: 2,
      max: 18,
      step: 1,
      default: 6,
    });
    expect(UNIVERSE_VIEW_LIMITS.cachedEventBundles).toMatchObject({
      min: 12,
      max: 96,
      step: 6,
      default: 24,
    });
  });

  it("reads only the current storage key and schema", () => {
    const storage = memoryStorage({
      "sag:universe-view-preferences:v4": JSON.stringify({
        version: 4,
        visibleEventBundles: 2,
      }),
    });
    expect(loadUniverseViewPreferences(storage)).toEqual(
      DEFAULT_UNIVERSE_VIEW_PREFERENCES,
    );

    storage.setItem(UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify({
      ...DEFAULT_UNIVERSE_VIEW_PREFERENCES,
      showEventCards: false,
    }));
    expect(loadUniverseViewPreferences(storage).showEventCards).toBe(false);
  });

  it("rejects every non-current schema without migration", () => {
    expect(normalizeUniverseViewPreferences({
      version: 4,
      visibleEventBundles: 18,
      cachedEventBundles: 96,
      showEventCards: false,
    })).toEqual(DEFAULT_UNIVERSE_VIEW_PREFERENCES);
  });

  it("normalizes an empty category selection back to all categories", () => {
    expect(preferences({ entityCategories: [] }).entityCategories).toBeNull();
    expect(preferences({ entityCategories: ["", "  "] }).entityCategories).toBeNull();
  });

  it("rounds cache capacity upward for one history and two forward pages", () => {
    expect(preferences({
      visibleEventBundles: 2,
      cachedEventBundles: 13,
    }).cachedEventBundles).toBe(24);
    expect(preferences({
      visibleEventBundles: 13,
      cachedEventBundles: 12,
    }).cachedEventBundles).toBe(36);
    expect(minimumUniverseCacheBundles(18)).toBe(36);
  });

  it("applies the larger desktop and mobile device caps", () => {
    expect(effectiveUniverseBundleWindow(
      DEFAULT_UNIVERSE_VIEW_PREFERENCES,
      false,
    )).toEqual({
      visibleEventBundles: 6,
      cachedEventBundles: 24,
    });
    expect(effectiveUniverseBundleWindow(preferences({
      visibleEventBundles: 18,
      cachedEventBundles: 96,
    }), false)).toEqual({
      visibleEventBundles: 18,
      cachedEventBundles: 96,
    });
    expect(effectiveUniverseBundleWindow(preferences({
      visibleEventBundles: 18,
      cachedEventBundles: 96,
    }), true)).toEqual({
      visibleEventBundles: 8,
      cachedEventBundles: 36,
    });
  });
});

describe("universe rendering budgets", () => {
  it("keeps the factual budget independent from presentation settings", () => {
    expect(effectiveUniverseBudget({ nodes: 800, edges: 1500 })).toEqual({
      nodes: 240,
      edges: 360,
    });
  });

  it("never exceeds a smaller renderer policy", () => {
    expect(effectiveUniverseBudget({ nodes: 24, edges: 30 }))
      .toEqual({ nodes: 24, edges: 30 });
  });
});

describe("entity-category projection", () => {
  it("always keeps events while filtering entities and their dangling mentions", () => {
    const current = workingSet();
    const projected = projectUniverseWorkingSet(current, ["Person"]);

    expect(projected.nodes.map((item) => item.id)).toEqual([
      "event-1",
      "person-1",
      "event-2",
    ]);
    expect(projected.relations.map((relation) => relation.kind)).toEqual([
      "mentions",
      "subevent",
    ]);
    expect(projected.nodes.some((item) => item.id === "org-1")).toBe(false);
    expect(projected.relations.some((relation) => relation.to_id === "org-1"))
      .toBe(false);
    const nodeIds = new Set(projected.nodes.map((item) => item.id));
    expect(projected.relations.every((relation) =>
      nodeIds.has(relation.from_id) && nodeIds.has(relation.to_id)))
      .toBe(true);
    expect(projected.relations.some((relation) => relation.kind === "subevent"))
      .toBe(true);
    expect(current.nodes).toHaveLength(4);
  });

  it("returns the full network for all or an empty untrusted selection", () => {
    const current = workingSet();
    expect(projectUniverseWorkingSet(current, null)).toBe(current);
    expect(projectUniverseWorkingSet(current, [])).toBe(current);
  });
});

describe("adaptive universe cards", () => {
  it("uses the fixed balanced budget when both card kinds are enabled", () => {
    const budget = universeCardBudget(1280, 720, true, true);
    expect(budget.total).toBe(14);
    expect(budget.events).toBe(6);
    expect(budget.entities).toBe(8);
  });

  it("assigns the full budget to one enabled kind and allows no persistent cards", () => {
    expect(universeCardBudget(1280, 720, true, false)).toEqual({
      events: 14,
      entities: 0,
      total: 14,
    });
    expect(universeCardBudget(1280, 720, false, true)).toEqual({
      events: 0,
      entities: 14,
      total: 14,
    });
    expect(universeCardBudget(1280, 720, false, false)).toEqual({
      events: 0,
      entities: 0,
      total: 0,
    });
  });
});

describe("universe entity category registry", () => {
  it("merges, trims and sorts discovered categories", () => {
    const storage = memoryStorage();

    publishUniverseEntityCategories([" organization ", "concept"], storage);
    publishUniverseEntityCategories(["location", "concept", ""], storage);

    expect(loadUniverseEntityCategories(storage)).toEqual([
      "concept",
      "location",
      "organization",
    ]);
  });

  it("recovers safely from malformed persisted data", () => {
    const storage = memoryStorage({
      "sag:universe-entity-categories": "not-json",
    });
    expect(loadUniverseEntityCategories(storage)).toEqual([]);
  });
});
