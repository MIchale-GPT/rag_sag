export interface UniverseSceneDeltaPlan {
  retainedIds: string[];
  enteringIds: string[];
  exitingIds: string[];
  topologyChanged: boolean;
}

/**
 * Stable identity diff used by the WebGL scene. Retained ids are deliberately
 * separated from entrants so an ordinary window step can never reset the
 * opacity or object identity of the overlapping network.
 */
export function planUniverseSceneDelta(
  previousIds: Iterable<string>,
  nextIds: Iterable<string>,
): UniverseSceneDeltaPlan {
  const previous = [...new Set(previousIds)];
  const next = [...new Set(nextIds)];
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  const retainedIds = next.filter((id) => previousSet.has(id));
  const enteringIds = next.filter((id) => !previousSet.has(id));
  const exitingIds = previous.filter((id) => !nextSet.has(id));
  return {
    retainedIds,
    enteringIds,
    exitingIds,
    topologyChanged: enteringIds.length > 0 || exitingIds.length > 0,
  };
}

/** Continuous fan distance; unlike discrete lanes, every visible step moves. */
export function universeTimelineFanProgress(age: number, total: number) {
  const denominator = Math.max(1, Math.floor(total) - 1);
  const normalized = Math.min(1, Math.max(0, age / denominator));
  return 1 - Math.pow(1 - normalized, 2.2);
}
