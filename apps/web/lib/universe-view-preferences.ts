"use client";

import * as React from "react";

import {
  UNIVERSE_SCENE_BUDGET,
  universeNodeKey,
  type UniverseWorkingSet,
} from "./universe-working-set";
import { recommendedUniverseTimelineCacheLimit } from "./universe-timeline-prefetch";

export const UNIVERSE_VIEW_PREFERENCES_VERSION = 5;
export const UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY =
  "sag:universe-view-preferences:v5";
export const UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY =
  "sag:universe-entity-categories";

const UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT =
  "sag:universe-view-preferences-change";
const UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT =
  "sag:universe-entity-categories-change";
const MAX_REMEMBERED_ENTITY_CATEGORIES = 64;

export interface UniverseViewPreferences {
  version: typeof UNIVERSE_VIEW_PREFERENCES_VERSION;
  visibleEventBundles: number;
  cachedEventBundles: number;
  showEventCards: boolean;
  showEntityCards: boolean;
  /** `null` means every discovered entity category is selected. */
  entityCategories: string[] | null;
}

/** Limits shared by normalization, UI controls and the virtual bundle window. */
export const UNIVERSE_VIEW_LIMITS = {
  visibleEventBundles: {
    min: 2,
    max: 18,
    step: 1,
    default: 6,
  },
  cachedEventBundles: {
    min: 12,
    max: 96,
    step: 6,
    default: 24,
  },
  deviceBundleCaps: {
    desktop: { visible: 18, cached: 96 },
    mobile: { visible: 8, cached: 36 },
  },
  cards: {
    areaPerCard: 64_000,
    max: 20,
    eventShare: 0.42,
  },
} as const;

export const DEFAULT_UNIVERSE_VIEW_PREFERENCES: Readonly<UniverseViewPreferences> =
  Object.freeze({
    version: UNIVERSE_VIEW_PREFERENCES_VERSION,
    visibleEventBundles: UNIVERSE_VIEW_LIMITS.visibleEventBundles.default,
    cachedEventBundles: UNIVERSE_VIEW_LIMITS.cachedEventBundles.default,
    showEventCards: true,
    showEntityCards: true,
    entityCategories: null,
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundUpToStep(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function cloneDefaultPreferences(): UniverseViewPreferences {
  return {
    ...DEFAULT_UNIVERSE_VIEW_PREFERENCES,
    entityCategories: null,
  };
}

function normalizeEntityCategories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((category): category is string => typeof category === "string")
    .map((category) => category.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN"))
    .slice(0, MAX_REMEMBERED_ENTITY_CATEGORIES);
}

/** Visible time window + one history page + two prefetched forward pages. */
export function minimumUniverseCacheBundles(visibleEventBundles: number) {
  const visible = clamp(
    finiteInteger(
      visibleEventBundles,
      UNIVERSE_VIEW_LIMITS.visibleEventBundles.default,
    ),
    UNIVERSE_VIEW_LIMITS.visibleEventBundles.min,
    UNIVERSE_VIEW_LIMITS.visibleEventBundles.max,
  );
  return clamp(
    roundUpToStep(
      recommendedUniverseTimelineCacheLimit(
        visible,
        UNIVERSE_VIEW_LIMITS.cachedEventBundles.step,
      ),
      UNIVERSE_VIEW_LIMITS.cachedEventBundles.step,
    ),
    UNIVERSE_VIEW_LIMITS.cachedEventBundles.min,
    UNIVERSE_VIEW_LIMITS.cachedEventBundles.max,
  );
}

/** Converts persisted or partially trusted data into the strict current schema. */
export function normalizeUniverseViewPreferences(
  value: unknown,
): UniverseViewPreferences {
  const input = isRecord(value) && value.version === UNIVERSE_VIEW_PREFERENCES_VERSION
    ? value
    : {};
  const visibleEventBundles = clamp(
    finiteInteger(
      input.visibleEventBundles,
      UNIVERSE_VIEW_LIMITS.visibleEventBundles.default,
    ),
    UNIVERSE_VIEW_LIMITS.visibleEventBundles.min,
    UNIVERSE_VIEW_LIMITS.visibleEventBundles.max,
  );
  const requestedCache = roundUpToStep(
    finiteInteger(
      input.cachedEventBundles,
      UNIVERSE_VIEW_LIMITS.cachedEventBundles.default,
    ),
    UNIVERSE_VIEW_LIMITS.cachedEventBundles.step,
  );
  const cachedEventBundles = clamp(
    Math.max(
      requestedCache,
      minimumUniverseCacheBundles(visibleEventBundles),
    ),
    UNIVERSE_VIEW_LIMITS.cachedEventBundles.min,
    UNIVERSE_VIEW_LIMITS.cachedEventBundles.max,
  );
  const selectedEntityCategories = normalizeEntityCategories(input.entityCategories);

  return {
    version: UNIVERSE_VIEW_PREFERENCES_VERSION,
    visibleEventBundles,
    cachedEventBundles,
    showEventCards: typeof input.showEventCards === "boolean"
      ? input.showEventCards
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.showEventCards,
    showEntityCards: typeof input.showEntityCards === "boolean"
      ? input.showEntityCards
      : DEFAULT_UNIVERSE_VIEW_PREFERENCES.showEntityCards,
    entityCategories: selectedEntityCategories.length > 0
      ? selectedEntityCategories
      : null,
  };
}

export interface UniverseBundleWindow {
  visibleEventBundles: number;
  cachedEventBundles: number;
}

/** Applies device caps while retaining a six-bundle prefetch runway. */
export function effectiveUniverseBundleWindow(
  preferences: UniverseViewPreferences,
  isMobile: boolean,
): UniverseBundleWindow {
  const normalized = normalizeUniverseViewPreferences(preferences);
  const caps = isMobile
    ? UNIVERSE_VIEW_LIMITS.deviceBundleCaps.mobile
    : UNIVERSE_VIEW_LIMITS.deviceBundleCaps.desktop;
  const visibleEventBundles = Math.min(
    normalized.visibleEventBundles,
    caps.visible,
  );
  const cachedEventBundles = Math.max(
    minimumUniverseCacheBundles(visibleEventBundles),
    Math.min(normalized.cachedEventBundles, caps.cached),
  );
  return { visibleEventBundles, cachedEventBundles };
}

export interface UniverseSceneBudget {
  nodes: number;
  edges: number;
}

/** Applies the renderer's hard safety budget independently from view settings. */
export function effectiveUniverseBudget(
  policyBudget: UniverseSceneBudget,
): UniverseSceneBudget {
  const policyNodes = Math.min(
    UNIVERSE_SCENE_BUDGET.desktop.nodes,
    Math.max(0, finiteInteger(policyBudget.nodes, 0)),
  );
  const policyEdges = Math.min(
    UNIVERSE_SCENE_BUDGET.desktop.edges,
    Math.max(0, finiteInteger(policyBudget.edges, 0)),
  );
  return {
    nodes: policyNodes,
    edges: policyEdges,
  };
}

/**
 * Applies the explicit entity-category filter without ever removing events.
 * Card visibility remains a scene-only concern and does not enter this path.
 */
export function projectUniverseWorkingSet(
  current: UniverseWorkingSet,
  entityCategories: string[] | null,
): UniverseWorkingSet {
  if (entityCategories === null) return current;
  const selectedCategories = new Set(normalizeEntityCategories(entityCategories));
  if (selectedCategories.size === 0) return current;
  const nodes = current.nodes.filter((node) =>
    node.kind === "event"
    || selectedCategories.has((node.category ?? "").trim()));
  const keptKeys = new Set(nodes.map((node) =>
    universeNodeKey(node.kind, node.id, node.source_id)));
  const relations = current.relations.filter((relation) => {
    const targetKind = relation.kind === "subevent" ? "event" : "entity";
    return keptKeys.has(universeNodeKey("event", relation.from_id, relation.source_id))
      && keptKeys.has(universeNodeKey(targetKind, relation.to_id, relation.source_id));
  });

  return {
    ...current,
    nodes,
    relations,
    root_keys: current.root_keys.filter((key) => keptKeys.has(key)),
    node_order: current.node_order.filter((key) => keptKeys.has(key)),
  };
}

export interface UniverseCardBudget {
  events: number;
  entities: number;
  total: number;
}

/** Calculates an adaptive on-canvas card cap without affecting graph content. */
export function universeCardBudget(
  width: number,
  height: number,
  showEventCards: boolean,
  showEntityCards: boolean,
): UniverseCardBudget {
  const safeWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
  const safeHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
  if (
    safeWidth === 0
    || safeHeight === 0
    || (!showEventCards && !showEntityCards)
  ) {
    return { events: 0, entities: 0, total: 0 };
  }

  const total = Math.max(0, Math.min(
    UNIVERSE_VIEW_LIMITS.cards.max,
    Math.floor(
      (safeWidth * safeHeight) / UNIVERSE_VIEW_LIMITS.cards.areaPerCard,
    ),
  ));
  if (total === 0) return { events: 0, entities: 0, total: 0 };
  if (!showEntityCards) return { events: total, entities: 0, total };
  if (!showEventCards) return { events: 0, entities: total, total };

  const events = total === 1
    ? 1
    : clamp(
        Math.round(total * UNIVERSE_VIEW_LIMITS.cards.eventShare),
        1,
        total - 1,
      );
  return {
    events,
    entities: total - events,
    total,
  };
}

type UniverseViewStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): UniverseViewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dispatchBrowserEvent(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(name));
}

export function loadUniverseViewPreferences(
  storage: UniverseViewStorage | null = defaultStorage(),
): UniverseViewPreferences {
  if (!storage) return cloneDefaultPreferences();
  try {
    const raw = storage.getItem(UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeUniverseViewPreferences(JSON.parse(raw)) : cloneDefaultPreferences();
  } catch {
    return cloneDefaultPreferences();
  }
}

export function saveUniverseViewPreferences(
  preferences: UniverseViewPreferences,
  storage: UniverseViewStorage | null = defaultStorage(),
): UniverseViewPreferences {
  const normalized = normalizeUniverseViewPreferences(preferences);
  if (!storage) return normalized;
  try {
    storage.setItem(
      UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // Storage can be unavailable (private mode, quota, or embedded contexts).
  }
  return normalized;
}

export type UniverseViewPreferencesUpdate =
  | Partial<UniverseViewPreferences>
  | ((current: UniverseViewPreferences) => Partial<UniverseViewPreferences>);

export function updateStoredUniverseViewPreferences(
  update: UniverseViewPreferencesUpdate,
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  const current = loadUniverseViewPreferences(storage);
  const patch = typeof update === "function" ? update(current) : update;
  return saveUniverseViewPreferences({ ...current, ...patch }, storage);
}

export function resetStoredUniverseViewPreferences(
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  try {
    storage?.removeItem(UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY);
  } catch {
    // Reset still succeeds in memory if persistent storage is unavailable.
  }
  return cloneDefaultPreferences();
}

export interface UseUniverseViewPreferencesResult {
  preferences: UniverseViewPreferences;
  updatePreferences: (update: UniverseViewPreferencesUpdate) => void;
  resetPreferences: () => void;
}

export function useUniverseViewPreferences(): UseUniverseViewPreferencesResult {
  const [preferences, setPreferences] = React.useState<UniverseViewPreferences>(
    cloneDefaultPreferences,
  );

  const updatePreferences = React.useCallback((update: UniverseViewPreferencesUpdate) => {
    const next = updateStoredUniverseViewPreferences(update);
    setPreferences(next);
    dispatchBrowserEvent(UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT);
  }, []);

  const resetPreferences = React.useCallback(() => {
    setPreferences(resetStoredUniverseViewPreferences());
    dispatchBrowserEvent(UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT);
  }, []);

  React.useEffect(() => {
    // Keep the server snapshot deterministic, then hydrate browser preferences.
    setPreferences(loadUniverseViewPreferences());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === UNIVERSE_VIEW_PREFERENCES_STORAGE_KEY
        || event.key === null
      ) {
        setPreferences(loadUniverseViewPreferences());
      }
    };
    const onPreferenceChange = () => {
      setPreferences(loadUniverseViewPreferences());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(
      UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT,
      onPreferenceChange,
    );
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        UNIVERSE_VIEW_PREFERENCES_CHANGE_EVENT,
        onPreferenceChange,
      );
    };
  }, []);

  return { preferences, updatePreferences, resetPreferences };
}

/** Keeps discovered categories available while the graph renderer is asleep. */
export function loadUniverseEntityCategories(
  storage: UniverseViewStorage | null = defaultStorage(),
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY);
    return raw ? normalizeEntityCategories(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function publishUniverseEntityCategories(
  categories: string[],
  storage: UniverseViewStorage | null = defaultStorage(),
) {
  const current = loadUniverseEntityCategories(storage);
  const next = normalizeEntityCategories([...current, ...categories]);
  if (next.join("\u0000") === current.join("\u0000")) return current;
  try {
    storage?.setItem(
      UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // The current graph still supplies its categories when storage is unavailable.
  }
  dispatchBrowserEvent(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT);
  return next;
}

export function useUniverseEntityCategories() {
  const [categories, setCategories] = React.useState<string[]>([]);

  React.useEffect(() => {
    const refresh = () => setCategories(loadUniverseEntityCategories());
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === UNIVERSE_ENTITY_CATEGORIES_STORAGE_KEY
        || event.key === null
      ) {
        refresh();
      }
    };
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UNIVERSE_ENTITY_CATEGORIES_CHANGE_EVENT, refresh);
    };
  }, []);

  return categories;
}
