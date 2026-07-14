import type { UniverseTimelineDirection } from "./types";

export interface UniverseTimelinePrefetchInput {
  /** Number of event times currently resident in the raw deque. */
  cacheLength: number;
  /** Focused event-time index in the canonical newest-to-oldest deque. */
  activeIndex: number;
  /** Maximum event times projected into the scene. */
  visibleLimit: number;
  /** Fixed raw-deque capacity. */
  cacheLimit: number;
  hasOlder: boolean;
  hasNewer: boolean;
  pageSize: number;
  /** The direction of the user's most recent explicit timeline action. */
  preferredDirection: UniverseTimelineDirection;
}

export interface UniverseTimelinePrefetchRunways {
  /** Cached event times strictly before the current visible window. */
  history: number;
  /** Cached event times after the active time, ready for deeper travel. */
  ahead: number;
  historyTarget: number;
  aheadTarget: number;
  lowWatermark: number;
  freeCapacity: number;
  projectedEvictions: number;
  olderEvictionSafe: boolean;
  newerEvictionSafe: boolean;
}

export type UniverseTimelinePrefetchReason =
  | "cache-empty"
  | "active-out-of-range"
  | "timeline-exhausted"
  | "runways-ready"
  | "capacity-starved-preferred-ready"
  | "fill-ahead"
  | "fill-history"
  | "older-low-water"
  | "newer-low-water"
  | "both-deficient-preferred-older"
  | "both-deficient-preferred-newer"
  | "both-deficient-safe-fallback-older"
  | "both-deficient-safe-fallback-newer"
  | "unsafe-older-eviction"
  | "unsafe-newer-eviction"
  | "unsafe-both-evictions";

export interface UniverseTimelinePrefetchPlan {
  direction: UniverseTimelineDirection | null;
  reason: UniverseTimelinePrefetchReason;
  runways: UniverseTimelinePrefetchRunways;
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Default fixed-cache budget: the visible scene, one page of reversible
 * history, and two pages already prepared in the exploration direction.
 */
export function recommendedUniverseTimelineCacheLimit(
  visibleLimit: number,
  pageSize: number,
) {
  return positiveInteger(visibleLimit, "visibleLimit")
    + positiveInteger(pageSize, "pageSize") * 3;
}

function idlePlan(
  reason: UniverseTimelinePrefetchReason,
  runways: UniverseTimelinePrefetchRunways,
): UniverseTimelinePrefetchPlan {
  return { direction: null, reason, runways };
}

/**
 * Chooses at most one adjacent page to preload without mutating timeline
 * state. The raw deque stays fixed-size: an older page may retire only history
 * before the visible window, while a newer page may retire only prepared
 * event times after the active one.
 *
 * While capacity remains, the policy fills the default 1-page history and
 * 2-page ahead targets. At capacity it switches to a 1-page low watermark,
 * which leaves hysteresis between filling and the next request. When the
 * configured capacity cannot hold both low-water runways, only the user's
 * preferred side is maintained; this prevents automatic older/newer churn.
 */
export function planUniverseTimelinePrefetch(
  input: UniverseTimelinePrefetchInput,
): UniverseTimelinePrefetchPlan {
  const cacheLength = nonNegativeInteger(input.cacheLength, "cacheLength");
  const visibleLimit = positiveInteger(input.visibleLimit, "visibleLimit");
  const cacheLimit = positiveInteger(input.cacheLimit, "cacheLimit");
  const pageSize = positiveInteger(input.pageSize, "pageSize");
  if (!Number.isInteger(input.activeIndex)) {
    throw new Error("activeIndex must be an integer");
  }

  const activeIsValid = cacheLength > 0
    && input.activeIndex >= 0
    && input.activeIndex < cacheLength;
  const visibleStart = activeIsValid
    ? Math.max(0, input.activeIndex - visibleLimit + 1)
    : 0;
  const history = visibleStart;
  const ahead = activeIsValid
    ? cacheLength - input.activeIndex - 1
    : 0;
  const projectedEvictions = Math.max(
    0,
    cacheLength + pageSize - cacheLimit,
  );
  const runways: UniverseTimelinePrefetchRunways = {
    history,
    ahead,
    historyTarget: input.hasNewer ? pageSize : 0,
    aheadTarget: input.hasOlder ? pageSize * 2 : 0,
    lowWatermark: pageSize,
    freeCapacity: Math.max(0, cacheLimit - cacheLength),
    projectedEvictions,
    olderEvictionSafe: input.hasOlder && projectedEvictions <= history,
    newerEvictionSafe: input.hasNewer && projectedEvictions <= ahead,
  };

  if (cacheLength === 0) return idlePlan("cache-empty", runways);
  if (!activeIsValid) return idlePlan("active-out-of-range", runways);
  if (!input.hasOlder && !input.hasNewer) {
    return idlePlan("timeline-exhausted", runways);
  }

  const cacheIsFull = cacheLength >= cacheLimit;
  let needsOlder: boolean;
  let needsNewer: boolean;
  if (cacheIsFull) {
    needsOlder = input.hasOlder && ahead < pageSize;
    needsNewer = input.hasNewer && history < pageSize;

    // A cache smaller than visible + two low-water pages can maintain only
    // one direction without immediately undoing its previous admission.
    const cannotHoldBothLowWatermarks = Math.max(0, cacheLimit - visibleLimit)
      < pageSize * 2;
    if (cannotHoldBothLowWatermarks) {
      if (input.preferredDirection === "older" && input.hasOlder) {
        needsNewer = false;
      } else if (input.preferredDirection === "newer" && input.hasNewer) {
        needsOlder = false;
      }
    }
  } else {
    needsOlder = input.hasOlder && ahead < runways.aheadTarget;
    needsNewer = input.hasNewer && history < runways.historyTarget;
  }

  if (!needsOlder && !needsNewer) {
    const preferredRunway = input.preferredDirection === "older"
      ? ahead
      : history;
    const preferredEdgeExists = input.preferredDirection === "older"
      ? input.hasOlder
      : input.hasNewer;
    const capacityStarved = cacheIsFull
      && Math.max(0, cacheLimit - visibleLimit) < pageSize * 2;
    if (
      capacityStarved
      && preferredEdgeExists
      && preferredRunway >= pageSize
    ) {
      return idlePlan("capacity-starved-preferred-ready", runways);
    }
    return idlePlan("runways-ready", runways);
  }

  if (needsOlder && needsNewer) {
    const preferredSafe = input.preferredDirection === "older"
      ? runways.olderEvictionSafe
      : runways.newerEvictionSafe;
    const fallbackDirection: UniverseTimelineDirection =
      input.preferredDirection === "older" ? "newer" : "older";
    const fallbackSafe = fallbackDirection === "older"
      ? runways.olderEvictionSafe
      : runways.newerEvictionSafe;
    if (preferredSafe) {
      return {
        direction: input.preferredDirection,
        reason: input.preferredDirection === "older"
          ? "both-deficient-preferred-older"
          : "both-deficient-preferred-newer",
        runways,
      };
    }
    if (fallbackSafe) {
      return {
        direction: fallbackDirection,
        reason: fallbackDirection === "older"
          ? "both-deficient-safe-fallback-older"
          : "both-deficient-safe-fallback-newer",
        runways,
      };
    }
    return idlePlan("unsafe-both-evictions", runways);
  }

  if (needsOlder) {
    if (!runways.olderEvictionSafe) {
      return idlePlan("unsafe-older-eviction", runways);
    }
    return {
      direction: "older",
      reason: cacheIsFull ? "older-low-water" : "fill-ahead",
      runways,
    };
  }

  if (!runways.newerEvictionSafe) {
    return idlePlan("unsafe-newer-eviction", runways);
  }
  return {
    direction: "newer",
    reason: cacheIsFull ? "newer-low-water" : "fill-history",
    runways,
  };
}
