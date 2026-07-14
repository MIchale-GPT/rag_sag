export interface UniverseFocusCardNode {
  id: string;
  kind: "event" | "entity";
  sourceId: string;
}

export interface UniverseFocusCardPlan {
  ids: string[];
  eventCount: number;
  entityCount: number;
}

/**
 * Builds the unique, factual one-hop card group for persistent keyboard focus
 * and click lock. Transient pointer hover is intentionally narrowed to the
 * current card by the scene. Input order is retained so the scene can apply
 * its own stable priority without ever duplicating a shared entity.
 */
export function planUniverseFocusCards(
  nodes: Iterable<UniverseFocusCardNode>,
  focusId: string | null,
  neighborIds: Iterable<string>,
  sourceId: string | null,
): UniverseFocusCardPlan {
  if (!focusId || !sourceId) {
    return { ids: [], eventCount: 0, entityCount: 0 };
  }
  const networkIds = new Set([focusId, ...neighborIds]);
  const seen = new Set<string>();
  const ids: string[] = [];
  let eventCount = 0;
  let entityCount = 0;
  let focusFound = false;
  for (const node of nodes) {
    if (
      node.sourceId !== sourceId
      || !networkIds.has(node.id)
      || seen.has(node.id)
    ) continue;
    if (node.id === focusId) focusFound = true;
    seen.add(node.id);
    ids.push(node.id);
    if (node.kind === "event") eventCount += 1;
    else entityCount += 1;
  }
  if (!focusFound) return { ids: [], eventCount: 0, entityCount: 0 };
  return { ids, eventCount, entityCount };
}
