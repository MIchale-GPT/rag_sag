import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./knowledge-universe.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("knowledge universe production interaction policy", () => {
  it("separates resident browse capacity from the smaller render budget", () => {
    expect(source).toContain("effectiveUniverseBundleWindow(viewPreferences, mobile)");
    expect(source).toContain("bundleWindow.visibleEventBundles");
    expect(source).toContain("bundleWindow.cachedEventBundles");
    expect(source).toContain("effectiveUniverseBudget(policyBudget)");
    expect(source).toContain("UNIVERSE_RESIDENT_BUDGET.mobile");
    expect(source).toContain("UNIVERSE_RESIDENT_BUDGET.desktop");
    expect(source).toContain("residentBudgetRef.current = residentBudget");
    expect(source).toContain("data-universe-resident-node-budget={residentBudget.nodes}");
    expect(source).toContain("const EVENT_ENTITY_PROJECTION_LIMIT = 8");
    expect(source).toContain("const ENTITY_EXPANSION_EVENT_LIMIT = 4");
  });

  it("keeps normal layout flat and gives preview a temporal depth projection", () => {
    expect(source).toContain("timelineEventPlacementByKey");
    expect(source).toContain("projectUniverseTemporalBatch(");
    expect(source).toContain('displayModeState.mode === "preview"');
    expect(source).toContain("temporalProjection.normalizedOffset.z * radius");
    expect(source).toContain("stableRootEventOffset(");
    expect(source).toContain("presentationScale:");
    expect(source).toContain("presentationCardScale:");
    expect(source).toContain("presentationOpacity:");
  });

  it("keeps concrete-node clicks presentation-only", () => {
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const clearSelection = React.useCallback(",
    );
    expect(handler).toContain("nextUniverseLockedNodeId(");
    expect(handler).toContain("graphRef.current?.lockNode(nextLockedId)");
    expect(handler).toContain("graphRef.current?.clearSelection()");
    expect(handler).not.toContain("expandNode(");
    expect(handler).not.toContain("loadSourceTimelinePage(");
    expect(handler).not.toContain("api.");
  });

  it("clears a canvas lock without changing graph data or the camera", () => {
    const clearSelection = sourceBetween(
      "const clearSelection = React.useCallback(",
      "const handleSceneUnavailable = React.useCallback(",
    );
    const handler = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const clearSelection = React.useCallback(",
    );

    expect(clearSelection).toContain("graphRef.current?.clearSelection()");
    expect(clearSelection).toContain("setLockedKey(null)");
    expect(clearSelection).toContain("setSelectedKey(null)");
    expect(clearSelection).not.toMatch(/focusOverview\(|resetOverview\(|setData\(|loadSourceTimelinePage\(|api\./);
    expect(handler).not.toContain("commitWorkingSet(");
    expect(handler).not.toContain("setUniversePinnedNetwork(");
    expect(clearSelection).not.toContain("commitWorkingSet(");
    expect(clearSelection).not.toContain("setUniversePinnedNetwork(");
  });

  it("keeps transient hover inside the scene instead of mounting a second inspector", () => {
    expect(source).toContain("const inspectorNode = selectedConcreteNode;");
    expect(source).toContain("const handleSceneHover = React.useCallback(() => undefined, [])");
    expect(source).not.toContain("hoveredConcreteKey");
    expect(source).not.toContain("hoveredConcreteNode");
  });

  it("blocks timeline paging while a node is locked", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(intent).toContain("if (lockedKeyRef.current)");
    expect(intent).toContain('t("timeline.unlockToContinue")');
    expect(loader).toContain('lockedKeyRef.current && cause !== "source-entry"');
    expect(source).toContain("timelineAbortRef.current?.abort()");
  });

  it("keeps expansion behind the explicit inspector action", () => {
    expect(source).toContain("onClick={() => void expandNode(inspectorNode)}");
  });

  it("keeps one source session with cache, visible window and working set", () => {
    const commit = sourceBetween(
      "const commitWorkingSet = React.useCallback(",
      "const commitTimelineWindow = React.useCallback(",
    );
    const activation = sourceBetween(
      "const activateSource = React.useCallback(",
      "React.useEffect(() => {\n    const onSourceFocus",
    );
    expect(commit).toContain("session.working = next");
    expect(activation).toContain("const session = emptySourceBrowseSession(");
    expect(activation).toContain("bundleWindow.visibleEventBundles");
    expect(activation).toContain("bundleWindow.cachedEventBundles");
    expect(activation).toContain("sourceSessionRef.current = session");
    expect(activation).toContain("setTimelineWindow(session.timeline.window)");
    expect(source).not.toContain("sourceSessionsRef");
    expect(source).not.toContain("sourceTimelinePagesRef");
  });

  it("rejects delayed timeline responses after the active source session changes", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain("sourceSessionRef.current !== session");
    expect(loader).toContain("page.epoch !== epochRef.current");
    expect(loader).toContain("controller.signal.aborted");
  });

  it("reports bounded, semantically honest timeline progress", () => {
    expect(source).toContain("queriedUniverseTimelineEventCount(eventState.window)");
    expect(source).toContain('residentNodes.filter((node) => node.kind === "entity").length');
    expect(source).not.toContain("seenEventIds: Set<string>");
    expect(source).not.toContain("seenEntityIds: Set<string>");
  });

  it("separates server EOF from the user reaching the cached tail", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(source).toContain("const networkExhausted = !admission.deque.hasOlder");
    expect(source).toContain("state.deque = dequeAdmission.deque");
    expect(intent).toContain("session.timeline.deque?.hasOlder");
    expect(intent).toContain("markUniverseTimelineNetworkExhausted(current)");
    expect(intent).toContain('return "complete"');
  });

  it("prefetches one safe adjacent page from bidirectional watermarks", () => {
    const prefetch = sourceBetween(
      "const plan = planUniverseTimelinePrefetch({",
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
    );
    expect(prefetch).toContain("nextPageSize");
    expect(prefetch).toContain("hasOlder: session.timeline.deque.hasOlder");
    expect(prefetch).toContain("hasNewer: session.timeline.deque.hasNewer");
    expect(prefetch).toContain("preferredDirection: session.timeline.preferredDirection");
    expect(source).toContain('timelineWindow?.phase !== "idle"');
    expect(prefetch).toContain('"prefetch",\n      plan.direction');
  });

  it("keeps normal API page size independent from the visible slider", () => {
    const pageSizing = sourceBetween(
      "const pageBundleLimit = state.queryPageSize ?? universeTimelinePageBundleLimit(",
      "const requestCursor =",
    );
    expect(pageSizing).toContain("state.queryPageSize ??");
    expect(pageSizing).toContain("manifest.policy.timeline_event_page_size");
    expect(pageSizing).toContain("residentBudgetRef.current");
    expect(pageSizing).not.toContain("bundleWindow.visibleEventBundles");
    const prefetchSizing = sourceBetween(
      "const nextPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(",
      "const plan = planUniverseTimelinePrefetch({",
    );
    expect(prefetchSizing).toContain("session.timeline.queryPageSize ??");
    expect(prefetchSizing).toContain("manifest?.policy.timeline_event_page_size ?? 6");
    expect(prefetchSizing).toContain("residentBudget");
    expect(prefetchSizing).not.toContain("bundleWindow.visibleEventBundles");
  });

  it("reconfigures an idle window without moving the active bundle or dropping cached future", () => {
    const reconfiguration = sourceBetween(
      "if (current.phase === \"transitioning\") return;",
      "const activateSource = React.useCallback(",
    );
    expect(source).toContain('current.phase === "transitioning"');
    expect(reconfiguration).toContain("bundleWindow.visibleEventBundles");
    expect(reconfiguration).toContain("bundleWindow.cachedEventBundles");
    expect(reconfiguration).toContain("resizeUniverseTimelineDeque(");
    expect(reconfiguration).toContain("activeBundleId");
    expect(reconfiguration).toContain("next.cacheBundleIds");
    expect(reconfiguration).toContain("timelineRetentionBundleIds(");
    expect(source).not.toContain("const selectedIds = current.cacheBundleIds.slice(start)");
  });

  it("retains cached bundles and expansion branches owned by resident timeline roots", () => {
    const retention = sourceBetween(
      "function timelineRetentionBundleIds(",
      "function universeBundleWindowProtection(",
    );
    expect(retention).toContain("...timelineBundleIds");
    expect(retention).toContain("anchoredSupportIds");
    expect(retention).toContain("timelineNodeKeys");
    expect(retention).toContain("lineageQualifiedExpansionBundleIds");
  });

  it("projects only the bounded visible window while retaining the larger cache", () => {
    const projection = sourceBetween(
      "function timelineProjectionBundleIds(",
      "function timelineRetentionBundleIds(",
    );
    expect(projection).toContain("visibleTimelineBundleIds");
    expect(projection).toContain("visibleNodeKeys");
    expect(projection).toContain("timelineBundleIds");
    expect(projection).toContain("if (timelineIds.has(id)) return false");
    expect(source).toContain("projectUniverseBundleWindowWithinBudget(");
  });

  it("synchronizes physical retention after a window or cache change", () => {
    const retentionEffect = sourceBetween(
      "if (current.phase === \"transitioning\") return;",
      "const activateSource = React.useCallback(",
    );
    expect(retentionEffect).toContain('current.phase === "transitioning"');
    expect(retentionEffect).toContain("if (next !== current) commitTimelineWindow");
    expect(retentionEffect).toContain("const bundleOrderChanged =");
    expect(retentionEffect).toContain("if (!bundleOrderChanged) return");
    expect(retentionEffect.indexOf('session.timeline.pausedReason === "capacity"'))
      .toBeLessThan(retentionEffect.indexOf("if (!bundleOrderChanged) return"));
    expect(retentionEffect.indexOf("commitWorkingSet(retained)"))
      .toBeGreaterThan(retentionEffect.indexOf("if (!bundleOrderChanged) return"));
  });

  it("protects timeline cursor integrity during page and explicit expansion admission", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    expect(loader).toContain("admitUniverseTimelineDequePage(");
    expect(loader).toContain("synchronizeTimelineWindowWithDeque(");
    expect(loader).toContain(
      "const protectedTimelineBundleIds = synchronizedWindow.cacheBundleIds",
    );
    expect(loader).toContain("admission.evictedBundleIds");
    expect(loader).toContain("retainedDequeIds.has(id)");
    expect(loader).not.toContain("protectedCacheIds");
    expect(loader).toContain("!admission.pageAcknowledged");
    expect(loader.indexOf("synchronizeTimelineWindowWithDeque("))
      .toBeLessThan(loader.indexOf("state.snapshotId = page.snapshot_id"));
    expect(expansion).toContain("browseSession.timeline.window.cacheBundleIds");
    expect(expansion).toContain("visibleSupportBundleIds");
  });

  it("reports first-page EOF as complete and exposes capacity pauses", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const terminalHint = loader.indexOf('synchronizedWindow.phase === "complete"');
    const readyHint = loader.indexOf('t("timeline.windowReady"');
    expect(terminalHint).toBeGreaterThanOrEqual(0);
    expect(readyHint).toBeGreaterThan(terminalHint);
    expect(loader).toContain('t("timeline.explorationComplete"');
    expect(loader).toContain('state.pausedReason = "capacity"');
    expect(loader).toContain('t("timeline.capacityPaused"');
    expect(source).toContain("activeIndex < cacheLength - 1 || hasOlder");
    expect(source).toContain("activeIndex > startActiveIndex || hasNewer");
  });

  it("loads and commits one complete time page per explicit journey", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(loader).toContain("direction: UniverseTimelineDirection");
    expect(loader).toContain("admitUniverseTimelineDequePage(");
    expect(loader).toContain("universeTimelinePageBundleLimit(");
    expect(loader).toContain("state.queryPageSize ??= pageBundleLimit");
    expect(intent).toContain(
      "const queryPageSize = session.timeline.queryPageSize ?? universeTimelinePageBundleLimit(",
    );
    expect(intent).toContain("const pageStride = Math.min(");
    expect(intent).toContain("session.timeline.window.visibleLimit");
    expect(intent).toContain('direction === "next" ? "older" : "newer"');
    expect(intent).toContain('"journey",\n          requestDirection');
    expect(intent).toContain("advanceUniverseTimelineWindow(\n        current,\n        direction,\n        pageStride");
    expect(intent).toContain("const completeTerminalPage = localRunway > 0 && !edgeAvailable");
    expect(intent).toContain("localRunway < pageStride && !completeTerminalPage");
    expect(intent).toContain("planUniverseDisplayTimelineIntent(");
    expect(intent).toContain('commitUniverseDisplayIntent(state, displayPlan, "shifted")');
    expect(intent.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(intent.indexOf("commitTimelineWindow(session, next)"));
  });

  it("keeps active timeline bundles out of generic node-level budget trimming", () => {
    const budgetEffect = sourceBetween(
      "const current = workingRef.current;\n    const session = sourceSessionRef.current;\n    if (session) {",
      "const resetScene = React.useCallback(",
    );
    expect(budgetEffect).toContain("refreshLoadProgress()");
    expect(budgetEffect.indexOf("return;")).toBeLessThan(
      budgetEffect.indexOf("trimUniverseWorkingSet("),
    );
  });

  it("settles cached transitions and keys scene motion to visible bundle identity", () => {
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
    );
    expect(source).toContain("scheduleTimelineSettle(session, next)");
    expect(source).toContain("settleUniverseTimelineWindow(next)");
    expect(source).toContain("visibleTimelineBundleIds.join(\"|\")");
    expect(source).toContain("windowRevision: sceneWindowRevision");
    expect(source).toContain("timelineJourneyCommitRef");
    expect(source).toContain("windowChangeCause");
    expect(source).toContain('windowChangeCause: data.windowChangeCause ?? "synchronization"');
    expect(source).toContain("windowDirection: data.windowDirection ?? null");
    expect(source).toContain("timelineJourneyCommitRef.current = null");
    expect(source).toContain('? "journey"\n      : "synchronization"');
    expect(intent.indexOf("timelineJourneyCommitRef.current ="))
      .toBeLessThan(intent.indexOf("commitTimelineWindow(session, next)"));
  });

  it("projects visible and prioritized support bundles through the scene budget", () => {
    expect(source).toContain("timelineProjectionBundleIds(");
    expect(source).toContain("projectUniverseBundleWindowWithinBudget(");
    expect(source).toContain("visibleTimelineBundleIds");
    expect(source).toContain("timelineSupportBundleIds");
    expect(source).toContain("budget,");
    expect(source).toContain("retainUniverseWorkingSetBundles(");
    expect(source).toContain("universeBundleWindowProtection(");
    expect(source).toContain("protectedRelationKeys: windowProtection.relationKeys");
    expect(source).toContain("visibleSupportBundleIds");
    expect(source).toContain("...visibleSupportBundleIds");
    expect(source).not.toContain("visibleSupportLineageBundleIds");
  });

  it("bounds the configured timeline window by the effective scene budget", () => {
    const sizing = sourceBetween(
      "const configuredBundleWindow = React.useMemo(",
      "const refreshLoadProgress = React.useCallback(",
    );
    expect(sizing).toContain("manifest?.policy.event_entity_limit");
    expect(sizing).toContain("const packageCapacity = Math.min(");
    expect(sizing).toContain("requiredTransitionPackages");
    expect(sizing).toContain("transitionHeadroomPackages");
    expect(sizing).toContain("budget.nodes - transitionHeadroomPackages * nodesPerPackage");
    expect(sizing).toContain("budget.edges - transitionHeadroomPackages * edgesPerPackage");
    expect(sizing).toContain("configuredBundleWindow.visibleEventBundles");
    expect(sizing).toContain("cachedEventBundles: configuredBundleWindow.cachedEventBundles");
  });

  it("uses resident admission only for browse and keeps card flags out of graph data", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const selectedNode = React.useMemo(",
    );
    expect(expansion).toContain(
      "browseSession ? residentBudgetRef.current : budgetRef.current",
    );
    expect(loader).toContain("residentBudgetRef.current");
    expect(graph).toContain("projectedEntityCategories");
    expect(graph).toContain("projectUniverseWorkingSet(");
    expect(graph.indexOf("projectUniverseWorkingSet("))
      .toBeLessThan(graph.indexOf("timelineProjectionBundleIds("));
    expect(graph.indexOf("timelineProjectionBundleIds("))
      .toBeLessThan(graph.indexOf("projectUniverseBundleWindowWithinBudget("));
    expect(graph).not.toContain("showEventCards");
    expect(graph).not.toContain("showEntityCards");
    expect(graph).not.toContain("viewPreferences,");
  });

  it("projects and retains only expansion bundles owned by window lineage roots", () => {
    const projection = sourceBetween(
      "function timelineProjectionBundleIds(",
      "function universeBundleWindowProtection(",
    );
    expect(projection).toContain("lineageQualifiedExpansionBundleIds(");
    expect(projection).toContain('bundle?.origin === "expansion"');
    expect(projection).toContain("bundle.lineage_root_key");
    expect(projection).toContain("if (timelineIds.has(id)) return false");
  });

  it("keeps expansion cursors independent from FIFO payload eviction", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    const pruning = sourceBetween(
      "const pruneExpansionState = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(expansion).toContain("expansionLineageRootKey(");
    expect(expansion).toContain("lineageRootKey");
    expect(expansion).toContain("visibleSupportBundleIds");
    expect(expansion).toContain("protectedBundleIds:");
    expect(expansion).not.toContain("currentAnchorExpansionBundleIds");
    expect(loader).toContain("protectedTimelineBundleIds");
    expect(loader).toContain("...protectedTimelineBundleIds");
    expect(loader).toContain("...visibleSupportBundleIds");
    expect(pruning).not.toContain("cursorsRef.current.set(");
    expect(source).not.toContain("expansionSeedCursorsRef");
  });

  it("never reuses an expansion request whose abort signal has fired", () => {
    const request = sourceBetween(
      "const requestExpansion = React.useCallback(",
      "const expandNode = React.useCallback(",
    );
    expect(request).toContain("pending && !pending.signal.aborted");
    expect(request).toContain("pending.promise");
    expect(request).toContain("{ promise: request, signal }");
  });

  it("derives browse root roles from the visible window instead of cached ownership", () => {
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const selectedNode = React.useMemo(",
    );
    expect(graph).toContain("const visibleTimelineNodeKeys = new Set(");
    expect(graph).toContain("const isVisualRoot =");
    expect(graph).toContain("if (!timelineBrowseActive) return node.root");
    expect(graph).toContain("root: isVisualRoot(node)");
    expect(graph).toContain("timelineSupportBundleIds = timelineProjectionIds.filter");
    expect(graph).toContain("!visibleTimelineSet.has(id)).reverse()");
  });

  it("unlocks and releases pins when category projection hides the selected node", () => {
    const guard = sourceBetween(
      "const visibleNodeIds = new Set(graphData.nodes.map((node) => node.id));",
      "const handleSceneHover = React.useCallback(",
    );
    expect(guard).toContain("selectedMissing");
    expect(guard).toContain("lockedMissing");
    expect(guard).toContain("!visibleNodeIds.has(lockedKey)");
    expect(guard).toContain("clearSelection()");
    expect(guard).toContain("lockedKey, selectedKey");
  });

  it("keeps transient hover inside WebGL instead of rerendering the universe controller", () => {
    const hover = sourceBetween(
      "const handleSceneHover = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(hover).toContain("() => undefined");
    expect(hover).not.toContain("setHoveredConcreteKey");
  });

  it("routes timeline snapshot changes through the singular invalidation path", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain('reason.code === "snapshot_changed"');
    expect(loader).toContain("invalidateSourceSnapshot(sourceId, epoch)");
    expect(source).toContain("expansionSnapshotsRef.current.clear()");
    expect(source).toContain("cursorsRef.current.clear()");
    expect(source).toContain("expandedAnchorsRef.current.clear()");
  });

  it("automatically reloads one fresh root page after snapshot invalidation", () => {
    const invalidation = sourceBetween(
      "const invalidateSourceSnapshot = React.useCallback(",
      "React.useEffect(() => {\n    const onActivate",
    );
    expect(invalidation).toContain("snapshotReloadAttemptsRef.current");
    expect(invalidation).toContain("if (reloadAttempt > 1)");
    expect(invalidation).toContain('loader(sourceId, "source-entry")');
    expect(invalidation).toContain('result === "loaded"');
    expect(invalidation).toContain("sourceSessionRef.current !== refreshedSession");
    expect(invalidation).toContain('t("timeline.snapshotReloading")');
    expect(invalidation).toContain('t("timeline.snapshotReset")');
  });

  it("seeds explicit event exploration from each timeline neighbor cursor", () => {
    const loader = sourceBetween(
      "const loadSourceTimelinePage = React.useCallback(",
      "const activateSource = React.useCallback(",
    );
    expect(loader).toContain("bundle.neighbor_page.next_cursor");
    expect(loader).toContain("cursorsRef.current.set(eventKey");
    expect(loader).toContain("expandedAnchorsRef.current.add(eventKey)");
  });

  it("keeps click lock presentation-only and out of the working-set projection", () => {
    const click = sourceBetween(
      "const handleNodeClick = React.useCallback(",
      "const clearSelection = React.useCallback(",
    );
    expect(click).toContain("graphRef.current?.lockNode(nextLockedId)");
    expect(click).toContain("graphRef.current?.clearSelection()");
    expect(click).not.toContain("workingRef.current");
    expect(click).not.toContain("setUniversePinnedNetwork(");
    expect(source).not.toContain("function universeLockNetwork(");
  });

  it("binds expansion cache identity to revision and snapshot", () => {
    const cacheKey = sourceBetween(
      "function universeExpansionCacheKey(",
      "function waitForAbortableDelay(",
    );
    expect(cacheKey).toContain("sourceRevision");
    expect(cacheKey).toContain("snapshotId");
    expect(source).toContain("snapshot_id: snapshot?.snapshotId ?? null");
    expect(source).toContain("admitUniverseExpansionPage(");
  });

  it("ignores stale expansion errors after the source session changes", () => {
    const expansion = sourceBetween(
      "const expandNode = React.useCallback(",
      "const loadSourceTimelinePage = React.useCallback(",
    );
    expect(expansion).toContain("const requestSession = sourceSessionRef.current");
    expect(expansion).toContain("controller.signal.aborted");
    expect(expansion).toContain("requestEpoch !== epochRef.current");
    expect(expansion).toContain("sourceSessionRef.current !== requestSession");
    expect(expansion.indexOf("sourceSessionRef.current !== requestSession"))
      .toBeLessThan(expansion.indexOf("invalidateSourceSnapshot(exactNode.sourceId"));
  });

  it("keeps terminal expansion state after old resident facts are evicted", () => {
    const pruning = sourceBetween(
      "const pruneExpansionState = React.useCallback(",
      "React.useEffect(() => {",
    );
    expect(pruning).not.toContain("universeAnchorProgress(");
    expect(source).not.toContain("residentProgress >= exactNode.relatedCount");
    expect(source).toContain("expandedAnchorsRef.current.has(inspectorAnchorKey)");
    expect(source).toContain("!cursorsRef.current.has(inspectorAnchorKey)");
    expect(source).toContain("committedCount < totalCount");
  });

  it("uses explicit time buttons and reserves camera gestures for normal view", () => {
    expect(source).toContain("timelineJourney={timelineJourney}");
    expect(source).toContain("onTimelineIntent={handleTimelineIntent}");
    expect(source).toContain('graphRef.current?.moveTimeline("previous")');
    expect(source).toContain('graphRef.current?.moveTimeline("next")');
    expect(source).toContain('data-universe-timeline-controls="true"');
    expect(source).toContain("onCameraInteraction={restoreNormalPresentation}");
    expect(source).toContain("data-universe-display-mode={displayModeState.mode}");
  });

  it("keeps the time-page controls mounted while page availability changes", () => {
    const visibilityStart = source.indexOf("const timelineControlsVisible = Boolean(");
    expect(visibilityStart).toBeGreaterThanOrEqual(0);
    const visibilityEnd = source.indexOf(");", visibilityStart);
    expect(visibilityEnd).toBeGreaterThan(visibilityStart);
    const visibility = source.slice(visibilityStart, visibilityEnd + 2);

    expect(visibility).toContain("interactive");
    expect(visibility).toContain("browseSessionSourceId");
    expect(visibility).toContain("timelineWindow");
    expect(visibility).not.toContain("activePartition");
    expect(visibility).not.toMatch(/cacheBundleIds|hasNext|hasPrevious|phase|timelineJourney/);

    const controlsMarker = 'data-universe-timeline-controls="true"';
    const markerIndex = source.indexOf(controlsMarker);
    expect(markerIndex).toBeGreaterThanOrEqual(0);

    const controls = source.slice(
      Math.max(0, markerIndex - 600),
      markerIndex + 2_400,
    );

    // A timeline can be temporarily disabled while its first page or a source
    // switch is settling. That state must disable navigation, not unmount the
    // rail and make it appear to have vanished.
    expect(controls).not.toContain("interactive && timelineJourney.enabled");
    expect(controls).toContain("timelineControlsVisible && (");
    expect(controls).not.toMatch(/timelineJourney\.has(?:Previous|Next)\s*&&\s*\(/);

    expect(controls).toContain('graphRef.current?.moveTimeline("previous")');
    expect(controls).toContain('graphRef.current?.moveTimeline("next")');
    expect(controls).toContain("disabled={!timelineJourney.hasPrevious");
    expect(controls).toContain("disabled={!timelineJourney.hasNext");
    expect(controls.match(/timelineJourney\.phase === "loading"/g)).toHaveLength(2);
    expect(controls.match(/timelineJourney\.phase === "transitioning"/g)).toHaveLength(2);
  });

  it("does not let source LOD replace the active browse session", () => {
    const sourceLod = sourceBetween(
      "const handleSourceLod = React.useCallback(",
      "const handleTimelineIntent = React.useCallback(",
    );
    const activeSession = sourceLod.indexOf("sourceSessionRef.current?.sourceId");
    const sourceMismatchGuard = sourceLod.search(
      /(?:sessionSourceId\s*!==\s*sourceId|sourceId\s*!==\s*sessionSourceId)/,
    );
    const partitionWrite = sourceLod.indexOf("setActivePartition(sourceId)");

    expect(activeSession).toBeGreaterThanOrEqual(0);
    expect(sourceMismatchGuard).toBeGreaterThan(activeSession);
    expect(partitionWrite).toBeGreaterThan(sourceMismatchGuard);
    expect(partitionWrite).toBeGreaterThan(activeSession);
  });

  it("uses the browse session as the single timeline data authority", () => {
    const activation = sourceBetween(
      "const activateSource = React.useCallback(",
      "React.useEffect(() => {",
    );
    const intent = sourceBetween(
      "const handleTimelineIntent = React.useCallback(",
      "React.useEffect(() => {",
    );
    const prefetch = sourceBetween(
      "React.useEffect(() => {\n    const session = sourceSessionRef.current;",
      "const timelineJourney = React.useMemo<UniverseTimelineJourney>",
    );
    const graph = sourceBetween(
      "const graphData = React.useMemo(() => {",
      "const selectedNode = React.useMemo(",
    );

    expect(activation).toContain('activationOriginRef.current = "browse"');
    expect(activation).toContain('setActivationOrigin("browse")');
    expect(intent).not.toContain("session.sourceId !== activePartition");
    expect(prefetch).not.toContain("session.sourceId !== activePartition");
    expect(graph).toContain("const timelineBrowseActive = Boolean(browseSessionSourceId)");
    expect(graph).not.toContain("sourceSessionRef.current?.sourceId === activePartition");
  });

  it("keeps WebGL fallback, budget lock release and manifest invalidation", () => {
    expect(source).toContain("onUnavailable={handleSceneUnavailable}");
    expect(source).toContain("webglAvailable === false");
    expect(source).toContain("sceneUnavailableReason");
    expect(source).toContain("setSceneAttempt((current) => current + 1)");
    expect(source).not.toContain("failIfMajorPerformanceCaveat: true");
    expect(source).toContain("next.nodes.length > budget.nodes");
    expect(source).toContain("trimUniverseWorkingSet(\n        current,\n        budget,");
    expect(source).toContain("manifestVersionRef.current === manifest.version");
    expect(source).toContain("resetScene(epochRef.current + 1)");
  });
});
