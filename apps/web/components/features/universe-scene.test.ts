import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./universe-scene.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("universe scene production invariants", () => {
  it("keeps search presentation-only and never translates source coordinates", () => {
    expect(source).not.toMatch(
      /SourceTween|sourceTween|sourceTargets|applySourceTargets|updateSourceTween|easeInOutCubic/,
    );

    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(dataCommit).toContain("if (!this.paused && searchFocusSourceId) this.focusSource(");
    expect(dataCommit).not.toMatch(/sourceHits[\s\S]*?(?:\.x\s*=|\.y\s*=|\.z\s*=)/);
  });

  it("uses a static bounded-cost renderer contract", () => {
    expect(source).toContain(".enableNodeDrag(false)");
    expect(source).toContain(".linkDirectionalParticles(0)");
    expect(source).toContain(".linkWidth(() => this.linkWorldWidth())");
    expect(source).toContain(".linkResolution(3)");
    expect(source).toContain(".linkCurvature(0)");
    expect(source).not.toContain(".onNodeDrag(");
    expect(source).not.toContain(".onNodeDragEnd(");
    expect(source).not.toContain(".refresh(");
  });

  it("bounds large-canvas fill rate and avoids forced label layout on every camera frame", () => {
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    const pixelRatio = sourceBetween(
      "private updatePixelRatio()",
      "private handleResize = () =>",
    );

    expect(source).toContain("const MAX_RENDER_PIXELS_DESKTOP = 2_400_000");
    expect(source).toContain("const MAX_RENDER_PIXELS_MOBILE = 1_100_000");
    expect(pixelRatio).toContain("const areaCap = Math.sqrt(renderPixelBudget / cssPixelArea)");
    expect(pixelRatio).toContain("Math.min(window.devicePixelRatio || 1, qualityCap, areaCap)");
    expect(pixelRatio).toContain("this.host.dataset.universeRenderPixels");
    expect(cameraChange).toContain("this.updateLabels(performance.now())");
    expect(cameraChange).not.toContain("this.updateLabels(performance.now(), true)");
    expect(cameraChange).not.toContain("this.armNebulaAnimation(");
    expect(labelLayout.match(/this\.host\.getBoundingClientRect\(\)/g)).toHaveLength(1);
    expect(labelLayout).toContain("this.miniPanelRect(hostRect)");
    expect(labelLayout).toContain("hostRect,");
  });

  it("keeps wheel and drag camera-native while time navigation stays explicit", () => {
    const cameraStart = sourceBetween(
      "private handleControlsStart = () =>",
      "private handleControlsChange = () =>",
    );
    const cameraChange = sourceBetween(
      "private handleControlsChange = () =>",
      "private handlePointerMove = (event: PointerEvent)",
    );
    const intent = sourceBetween(
      "async moveTimeline(",
      "private createNodeObject(node: ForceNode)",
    );

    expect(source).toContain("export interface UniverseTimelineJourney");
    expect(source).toContain("windowRevision?: number");
    expect(source).toContain('this.controls.addEventListener("start", this.handleControlsStart)');
    expect(source).toContain('this.controls.addEventListener("change", this.handleControlsChange)');
    expect(source).toContain('this.controls.addEventListener("end", this.handleControlsEnd)');
    expect(source).not.toContain('this.host.addEventListener("wheel"');
    expect(source).not.toContain("timelineDepthGateReached");
    expect(source).not.toContain("timelineWheelAccumulator");
    expect(source).toContain("this.controls.minDistance = UNIVERSE_CAMERA_MIN_DISTANCE");
    expect(source).toContain("this.controls.maxDistance = UNIVERSE_CAMERA_MAX_DISTANCE");
    expect(source).toContain("this.controls.zoomToCursor = true");
    expect(cameraStart).toContain("this.cameraGesturePosition.copy(camera.position)");
    expect(cameraStart).toContain("this.lodArmed = true");
    expect(cameraStart).not.toContain("this.callbacks.onCameraInteraction()");
    expect(cameraChange).toContain("positionChanged || targetChanged");
    expect(cameraChange).toContain("this.callbacks.onCameraInteraction()");
    expect(cameraChange).not.toContain("moveTimeline(");
    expect(intent).toContain("await this.callbacks.onTimelineIntent(direction)");
    expect(intent).not.toContain("animateTimelineExit");
    expect(source).not.toContain("private animateTimelineExit(");
    expect(intent).not.toContain("this.timelineJourney.networkExhausted");
    expect(intent).toContain('this.timelineJourney.phase === "complete"');
    expect(intent).toContain('if (!this.timelineJourney.hasNext) return "blocked"');
    expect(intent).not.toContain("restoreTimelineExit");
  });

  it("reports locked timeline attempts without starting a scene transition", () => {
    const intent = sourceBetween(
      "async moveTimeline(",
      "private createNodeObject(node: ForceNode)",
    );
    const lockedAttempt = sourceBetween(
      "if (this.lockedId) {",
      "if (direction === \"next\")",
    );

    expect(lockedAttempt).toContain("await this.callbacks.onTimelineIntent(direction)");
    expect(lockedAttempt).toContain('this.host.dataset.universeTimelineResult = "blocked"');
    expect(lockedAttempt).toContain('return "blocked"');
    expect(lockedAttempt).not.toContain("this.animateTimelineExit");
    expect(intent.indexOf("if (this.lockedId)"))
      .toBeLessThan(intent.indexOf("this.timelineIntentPending = true"));
  });

  it("uses one stable transition for explicit page controls", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    expect(source).toContain('kind: "enter" | "shift" | "exit"');
    expect(source).toContain("planUniverseSceneDelta(");
    expect(source).toContain("private pruneRetiringTimelineElements()");
    expect(source).toContain("this.timelineExitSide(node, source)");
    expect(source).toContain("TIMELINE_EXIT_MIN_MS");
    expect(source).toContain("TIMELINE_ENTRY_MS");
    expect(dataCommit).toContain("const animateTimelineWindow = windowChanged");
    expect(dataCommit).toContain("nextWindowRevision !== this.dataWindowRevision");
    expect(dataCommit).toContain("timelineMotionFor(sceneNode, desired, currentSource)");
    expect(dataCommit).toContain("previousVisual");
    expect(dataCommit).toContain("existing.timelineRetiring = false");
    expect(dataCommit).toContain("node.timelineRetiring = true");
    expect(dataCommit).toContain('windowDirection === "previous"');
    expect(dataCommit).toContain("previousEntryDirection.normalize()");
    expect(dataCommit).toContain("collapseTarget");
    expect(dataCommit).toContain("if (topologyChanged) {");
    expect(dataCommit).toContain('this.timelineMotionPhase = "entering"');
    expect(source).toContain("const startWindowRevision = this.dataWindowRevision");
    expect(source).toContain("this.dataWindowRevision === startWindowRevision");
    expect(source).toContain("this.dataWindowRevision !== startWindowRevision");
    expect(source).not.toContain('event.key === "PageDown"');
    expect(source).toContain(
      "moveTimeline: (direction) => engineRef.current?.moveTimeline(direction)",
    );
    expect(source).not.toContain("waitForTimelineMotions");
  });

  it("starts every node in a timeline window on one shared batch clock", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const timelineMotion = sourceBetween(
      "const timelineMotionFor = (",
      "entrants.forEach((node) => {",
    );

    expect(dataCommit).toContain("const entryNow = performance.now()");
    expect(timelineMotion).toContain("startedAt: entryNow");
    expect(timelineMotion).not.toContain("timeline-entry-delay");
    expect(timelineMotion).not.toMatch(/startedAt:\s*entryNow\s*\+/);
  });

  it("invalidates a stale intent before applying an independent window change", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const interruptionGuard = sourceBetween(
      "private shouldCancelTimelineIntentForWindowChange(",
      "private syncTimelineDiagnostics()",
    );

    expect(source).toContain('windowChangeCause?: "journey" | "synchronization"');
    expect(dataCommit).toContain('data.windowChangeCause ?? "synchronization"');
    expect(dataCommit).toContain("this.shouldCancelTimelineIntentForWindowChange(");
    expect(dataCommit.indexOf("this.cancelTimelineTransition(true)"))
      .toBeLessThan(dataCommit.indexOf("this.dataWindowRevision = nextWindowRevision"));
    expect(interruptionGuard).toContain('if (cause === "journey") return false');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-result"');
    expect(interruptionGuard).toContain('this.timelineMotionPhase === "awaiting-data"');
  });

  it("settles an entering window before applying same-window synchronization", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );

    expect(dataCommit).toContain('windowChangeCause === "synchronization"');
    expect(dataCommit).toContain('this.timelineMotionPhase === "entering"');
    expect(dataCommit).toContain("this.cancelTimelineTransition(true)");
    expect(dataCommit).toContain(
      'if (this.timelineMotionPhase === "entering" && timelineMovingCount === 0)',
    );
  });

  it("never queues a time change from camera gestures", () => {
    expect(source).not.toContain("queuedTimelineDirection");
    expect(source).not.toContain("drainQueuedTimelineDirection");
    expect(source).not.toContain("timelineWheelDirection");
    expect(source).not.toContain("timelineWheelConsumed");
  });

  it("blocks label and keyboard activation while a timeline transition is busy", () => {
    const diagnostics = sourceBetween(
      "private syncTimelineDiagnostics()",
      "private pruneRetiringTimelineElements()",
    );
    const labelInteraction = sourceBetween(
      "private bindLabelInteraction(",
      "private updateLabels(now: number",
    );
    const keyboard = sourceBetween(
      "private handleKeyDown = (event: KeyboardEvent)",
      "private updatePixelRatio()",
    );
    expect(diagnostics).toContain("label.element.disabled = busy");
    expect(labelInteraction).toContain("if (this.timelineIsBusy()) return");
    expect(keyboard).toContain('this.timelineIsBusy() && event.key !== "Escape"');
    expect(keyboard).toContain('event.key.startsWith("Arrow")');
  });

  it("bounds transition ghosts and initializes deferred node objects at their live visual state", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );

    expect(source).toContain('import { UNIVERSE_SCENE_BUDGET } from "@/lib/universe-working-set"');
    expect(dataCommit).toContain("const transitionNodeBudget = Math.min(");
    expect(dataCommit).toContain("const transitionEdgeBudget = Math.min(");
    expect(dataCommit).toContain("remainingGhostNodeCapacity <= 0");
    expect(dataCommit).toContain("remainingGhostLinkCapacity <= 0");
    expect(dataCommit).toContain("this.host.dataset.universeDroppedGhostNodeCount");
    expect(dataCommit).toContain("this.host.dataset.universeDroppedGhostLinkCount");
    expect(nodeObject).toContain("node.object = group");
    expect(nodeObject).toContain("node.renderedEntryOpacity = undefined");
    expect(nodeObject).toContain("this.setObjectOpacity(");
    expect(nodeObject.indexOf("node.object = group"))
      .toBeLessThan(nodeObject.lastIndexOf("this.setObjectOpacity("));
  });

  it("freezes every deterministic position, including the end of entry motion", () => {
    expect(source).toContain("fx: number;");
    expect(source).toContain("fy: number;");
    expect(source).toContain("fz: number;");
    expect(source).toContain("fx: timelineMotion?.from.x ?? entry?.from.x ?? desired.x");
    expect(source).toContain("fy: timelineMotion?.from.y ?? entry?.from.y ?? desired.y");
    expect(source).toContain("fz: timelineMotion?.from.z ?? entry?.from.z ?? desired.z");
    expect(source).toContain("this.freezeNode(node, entry.to)");
    expect(source).toContain("this.syncFrozenNodeCoordinates()");
    expect(source).not.toMatch(/node\.f[xyz]\s*=\s*(?:null|undefined)/);
  });

  it("remembers filtered node destinations in a bounded epoch-local cache", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(source).toContain("const MAX_PLACEMENT_MEMORY = 512");
    expect(dataCommit).toContain("this.placementTargets.clear()");
    expect(dataCommit).toContain("const remembered = this.placementTargets.get(node.id)");
    expect(dataCommit).toContain("this.rememberPlacement(node.id, target)");
    expect(source).toContain("while (this.placementTargets.size > MAX_PLACEMENT_MEMORY)");
    expect(source).toContain("this.host.dataset.universePlacementMemory");
    expect(source).toContain('if (node.kind === "event" || obstacle.kind === "event")');
    expect(source).toContain("const planarClearance = clearance * 0.78");
  });

  it("reveals the unique one-hop event and entity card group for hover and lock", () => {
    const labels = sourceBetween(
      "private rebuildLabels()",
      "private sortLabelsForLayout()",
    );
    const layout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    expect(source).toContain('import { planUniverseFocusCards } from "@/lib/universe-focus-cards"');
    expect(labels).toContain("const focusCardPlan = planUniverseFocusCards(");
    expect(labels).not.toContain("ids: [focusNode.id]");
    expect(labels).toContain("const focusCardIds = new Set(focusCardPlan.ids)");
    expect(labels).toContain("this.host.dataset.universeFocusCardCount");
    expect(labels).toContain("const showEventCards = this.viewPreferences.showEventCards");
    expect(labels).toContain("|| hasConcreteFocus");
    expect(labels).toContain("const showEntityCards = this.viewPreferences.showEntityCards");
    expect(labels).toContain("const cardBudget = universeCardBudget(");
    expect(labels).toContain('&& (node.kind === "event" ? showEventCards : showEntityCards)');
    expect(labels).toContain("const eventLimit = showEventCards");
    expect(labels).toContain("Math.max(cardBudget.events, focusCardPlan.eventCount)");
    expect(labels).toContain("const entityLimit = showEntityCards");
    expect(labels).toContain("Math.max(cardBudget.entities, focusCardPlan.entityCount)");
    expect(labels).toContain("Math.max(cardBudget.total, focusCardPlan.ids.length)");
    expect(labels).toContain("const transientHover =");
    expect(labels).toContain('(node.sceneNode.state === "active" || focusCardIds.has(node.id))');
    expect(labels).toContain("&& (!focusId || focusCardIds.has(node.id))");
    expect(labels).toContain('element.dataset.compact = String(node.kind === "entity")');
    expect(labels).toContain('node.kind === "event" && node.id === focusId');
    expect(labels).toContain("total: totalLimit");
    expect(labels).toContain("const eventCandidateLimit = hasConcreteFocus");
    expect(labels).toContain(": Math.min(60, eventLimit * 3)");
    expect(labels).toContain("const entityCandidateLimit = hasConcreteFocus");
    expect(labels).toContain(": Math.min(60, entityLimit * 3)");
    expect(labels).toContain("const totalCandidateLimit = hasConcreteFocus");
    expect(labels).toContain("? focusCardPlan.ids.length");
    expect(labels).toContain("this.labelPlacementBudget = {");
    expect(labels).toContain("this.host.dataset.universeEntityLabelCandidateCount");
    expect(labels).toContain("const existingLabels = new Map(");
    expect(labels).toContain("const nextLabels: SceneLabel[] = []");
    expect(labels).toContain("existingLabels.forEach((label) => label.element.remove())");
    expect(labels).not.toContain("this.labelLayer.replaceChildren()");
    expect(layout).toContain('const expanded = node.kind === "event"');
    expect(layout).toContain("&& node.id === labelFocusId");
    expect(layout).toContain("const requiredFocusCard =");
    expect(layout).toContain("Boolean(focusCardIds?.has(node.id))");
    expect(layout).toContain("new Set([labelFocusId, ...(labelFocusNeighbors ?? [])])");
    expect(layout).toContain("Math.max(0.72, calculatedOpacity)");
    expect(layout).toContain("const clampedCandidates = requiredFocusCard");
    expect(layout).toContain("const focusGridCandidates: LabelRect[] = []");
    expect(layout).toContain("requiredFocusCard || emphasized");
    expect(source).toContain("visibleEntityLabels >= this.labelPlacementBudget.entities");
    expect(source).toContain("this.host.dataset.universeEntityLabelCount");
    expect(labels).toContain('title.removeAttribute("title")');
    expect(labels).toContain('summary.removeAttribute("title")');
    expect(labels).not.toContain("title.title =");
    expect(labels).not.toContain("summary.title =");
    expect(labels).not.toContain('setAttribute("title"');

    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    expect(dataCommit).toContain("&& !link.virtual");
    expect(dataCommit).toContain("this.host.dataset.universeEventStarCount");

    const options = sourceBetween(
      "setOptions(options:",
      "\n  setSelection(selectedId: string | null)",
    );
    expect(options).toContain("const cardPreferencesChanged =");
    expect(options).toContain("if (this.dataReady && (cardPreferencesChanged || localeChanged)) this.rebuildLabels()");
    expect(options).not.toContain("graphData(");
  });

  it("dismisses a locked network atomically on blank canvas without reloading or moving it", () => {
    const backgroundClick = sourceBetween(
      ".onBackgroundClick(() => {",
      ".onEngineTick(() => {",
    );
    const clearSelection = sourceBetween(
      "  clearSelection() {",
      "\n  pause() {",
    );

    expect(backgroundClick).toContain("this.lockedId || this.selectedId || this.keyboardFocusedId");
    expect(backgroundClick).toContain("this.callbacks.onSelectionClear()");
    expect(backgroundClick.match(/this\.callbacks\.onSelectionClear\(\)/g)).toHaveLength(1);
    expect(backgroundClick.indexOf("this.lockedId || this.selectedId"))
      .toBeLessThan(backgroundClick.indexOf("this.timelineIsBusy()"));
    expect(backgroundClick).toContain("return;");
    expect(backgroundClick).not.toContain("this.clearKeyboardFocus(");
    expect(backgroundClick).not.toContain("this.rebuildLabels(");
    expect(clearSelection).toContain("this.lockedId = null");
    expect(clearSelection).toContain("this.selectedId = null");
    expect(clearSelection).toContain("this.hoveredId = null");
    expect(clearSelection).toContain("this.keyboardFocusedId = null");
    expect(clearSelection).toContain("this.rebuildLabels()");
    expect(clearSelection).toContain("this.applyHighlight()");
    expect(clearSelection).not.toMatch(/resetOverview\(|focusOverview\(|focusNode\(|setData\(|graphData\(/);
    expect(source).toContain("clearSelection: () => engineRef.current?.clearSelection()");
  });

  it("keeps event stars visible, reachable and clear of default cards", () => {
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );

    expect(nodeObject).toContain("map: this.eventTexture");
    expect(nodeObject).toContain("map: this.eventCoreTexture");
    expect(nodeObject).toContain("halo.userData.eventHalo = true");
    expect(nodeObject).toContain("sprite.userData.eventStar = true");
    expect(nodeObject).toContain("sprite.userData.eventCore = true");
    expect(nodeObject).toContain("hit.userData.eventHitArea = true");
    expect(nodeObject).toContain("const coreSize = node.sceneNode.root ? 9.6 : 7.6");
    expect(source).toContain("private nodeProjectionScale(node: ForceNode)");
    expect(source).toContain("? node.sceneNode.root ? 18 : 15");
    expect(source).toContain("? node.sceneNode.root ? 30 : 24");
    expect(source).toContain("projectedPixels > maximumPixels");
    expect(source).toContain("maximumPixels / projectedPixels");
    expect(source).toContain('opacity = node.kind === "event" ? 0.52 : 0.48');
    expect(labelLayout).toContain("const eventStarRects =");
    expect(labelLayout).toContain(
      'const overlapsEventStar = (rect: LabelRect) => label.kind === "node"',
    );
    expect(labelLayout).toContain("!overlapsEventStar(candidate)");
  });

  it("carries optional temporal presentation through mesh, card and link layers", () => {
    const objectVisual = sourceBetween(
      "private setObjectOpacity(node: ForceNode",
      "private nodeProjectionScale(node: ForceNode)",
    );
    const morphScale = sourceBetween(
      "private updateNodeMorphScales()",
      "private updateSourceAuraOpacities()",
    );
    const labels = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    const linkStyle = sourceBetween(
      "private linkVisualStyle(link: ForceLink)",
      "private ensureLinkMaterial(link: ForceLink)",
    );

    expect(source).toContain("presentationScale?: number");
    expect(source).toContain("presentationCardScale?: number");
    expect(source).toContain("presentationOpacity?: number");
    expect(source).toContain("function presentationScale(value: number | undefined)");
    expect(source).toContain("function presentationOpacity(value: number | undefined)");
    expect(source).toMatch(/function presentationScale[\s\S]*?: 1;/);
    expect(source).toMatch(/function presentationOpacity[\s\S]*?: 1;/);

    expect(objectVisual).toContain(
      "const dataScale = presentationScale(node.sceneNode.presentationScale)",
    );
    expect(objectVisual).toContain(
      "const dataOpacity = presentationOpacity(node.sceneNode.presentationOpacity)",
    );
    expect(objectVisual).toContain("* dataScale");
    expect(objectVisual).toContain("* detailFactor * dataOpacity");
    expect(morphScale).toContain("* dataScale");

    expect(labels).toContain("* dataOpacity");
    expect(labels).toContain(
      "presentationScale(node.sceneNode.presentationCardScale)",
    );
    expect(labels).toContain("scaledEventStarRadius");
    expect(linkStyle).toContain(
      "presentationOpacity(link.sceneLink.presentationOpacity)",
    );
    expect(linkStyle).toContain(") * dataOpacity");
  });

  it("renders every entity as a layered, minimum-size interactive glyph", () => {
    const nodeObject = sourceBetween(
      "private createNodeObject(node: ForceNode)",
      "private pinNode(node: ForceNode)",
    );

    expect(nodeObject).toContain("map: this.entityTexture");
    expect(nodeObject).toContain("map: this.entityCoreTexture");
    expect(nodeObject).toContain("halo.userData.entityHalo = true");
    expect(nodeObject).toContain("sprite.userData.entityCore = true");
    expect(nodeObject).toContain("hit.userData.entityHitArea = true");
    expect(nodeObject).toContain("const coreSize = node.sceneNode.root ? 5.2 : 4");
    expect(nodeObject).toContain("sprite.renderOrder = 2");
    expect(source).toContain(": node.sceneNode.root ? 10 : 8");
    expect(source).toContain("this.host.dataset.universeEntityGlyphCount");
  });

  it("shows every factual edge by default and only dims context on focus", () => {
    const dataCommit = sourceBetween(
      "setData(\n    data: UniverseSceneData",
      "\n  focusOverview() {",
    );
    const highlight = sourceBetween(
      "private applyHighlight()",
      "private updateObjectOpacities()",
    );
    const linkStyle = sourceBetween(
      "private linkVisualStyle(link: ForceLink)",
      "private ensureLinkMaterial(link: ForceLink)",
    );
    const detach = sourceBetween(
      "private detachSharedNodeResources(node: ForceNode)",
      "private makeClusterForce(): ClusterForce",
    );

    expect(dataCommit).toContain("existing.visible = true");
    expect(dataCommit).toContain("visible: true");
    expect(dataCommit).toContain(
      "this.visibleEdgeIds = new Set(this.links.map((link) => link.id))",
    );
    expect(dataCommit).toContain("link.visible = true");
    expect(highlight).toContain(
      "link.visible && anchorId && (source === anchorId || target === anchorId)",
    );
    expect(highlight).not.toMatch(/link\.visible\s*=/);
    expect(source).not.toContain("edgeDensity");
    expect(source).toContain("new THREE.MeshBasicMaterial(");
    expect(source).toContain("private restingLinkOpacity()");
    expect(source).toContain("private linkWorldWidth()");
    expect(source).toContain("return this.links.length >= 240 ? 0.1 : 0.2");
    expect(source).toContain("THREE.MathUtils.lerp(0.18, 0.055, load)");
    expect(source).toContain("depthTest: true");
    expect(source).toContain("material.depthTest = !link.highlighted");
    expect(source).toContain("link.__lineObj.renderOrder = link.highlighted ? 1 : 0");
    expect(source).toContain("private detachSharedNodeResources(node: ForceNode)");
    expect(source).toContain("candidate.geometry = undefined");
    expect(source).toContain("mapped.map = null");
    expect(detach).toContain("object.removeFromParent()");
    expect(detach).toContain("child.raycast = () => undefined");
    expect(detach.indexOf("object.removeFromParent()"))
      .toBeLessThan(detach.indexOf("candidate.geometry = undefined"));
    expect(detach.indexOf("child.raycast = () => undefined"))
      .toBeLessThan(detach.indexOf("candidate.geometry = undefined"));
    expect(source).toContain("link.lineMaterial = undefined");
    expect(source).toContain(
      "visibleEventLabels + visibleEntityLabels >= this.labelPlacementBudget.total",
    );
    expect(source).toContain("private syncGraphObjectPositions()");
    expect(source).toContain("node.object?.position.set(node.x, node.y, node.z)");
    expect(source).toContain("line.scale.z = start.distanceTo(end)");
    expect(source).toContain("if (hadEntry) {");
    expect(source).toContain("this.updateLinkVisuals()");
    expect(source).toContain("const position = candidate.entry?.to ?? candidate");
    expect(source).toContain("const entryKeepAliveMs = [...nextNodes.values()].reduce");
    expect(source).toContain("this.startLoop(entryKeepAliveMs)");
    expect(linkStyle).toContain("opacity: this.restingLinkOpacity()");
    expect(linkStyle).toContain("if (this.transientHoverFocusId())");
    expect(linkStyle).toContain("this.restingLinkOpacity() * 0.68");
    expect(linkStyle).toContain("if (this.labelFocusId())");
    expect(highlight).toContain("if (anchorId && !transientHover)");
    expect(highlight).toContain("this.syncHighlightFlowSprites()");
    expect(source).toContain("HIGHLIGHT_FLOW_FRAME_MS");
    expect(source).toContain("private updateHighlightFlowSprites(now: number)");
  });

  it("retires source proxies once concrete event stars enter detail", () => {
    expect(source).toContain("sprite.userData.sourceCore = true");
    expect(source).toContain("private sourceMarkerDetailFactor(");
    expect(source).toContain("return Math.max(0, 1 - detail)");
    expect(source).toContain("this.host.dataset.universeNebulaDetailFactor");
    expect(source).toContain("if (particle.sourceId === this.visualSourceId)");
    expect(source).toContain("this.updateNebulaAlphas();");
  });

  it("debounces pointer label rebuilds and restores defaults", () => {
    const hover = sourceBetween(
      "private scheduleHoverLabelRebuild(",
      "private applyHighlight()",
    );
    const labelLayout = sourceBetween(
      "private updateLabels(now: number",
      "private miniPanelRect(",
    );
    expect(hover).toContain("HOVER_LABEL_SETTLE_MS");
    expect(hover).toContain("HOVER_CLEAR_GRACE_MS");
    expect(hover).toContain("this.scheduleHoverLabelRebuild()");
    expect(hover).toContain("if (immediate || focusId === null) queueFrame()");
    expect(labelLayout).toContain(
      'const compact = label.kind === "node" && node.kind === "entity"',
    );
    expect(labelLayout).toContain("node.id === labelFocusId");
    expect(source).toContain("this.scheduleHoverLabelRebuild(true)");
    expect(source).toContain("this.cancelHoverLabelRebuild();");
    expect(source).toContain("this.cancelHoverClear();");
  });

  it("keeps one canvas tab stop and roves without moving or loading graph data", () => {
    const keyboard = sourceBetween(
      "private keyboardCandidates()",
      "private updatePixelRatio()",
    );
    const labelBinding = sourceBetween(
      "private bindLabelInteraction(",
      "private updateLabels(now: number",
    );

    expect(source).toContain("tabIndex={interactive ? 0 : -1}");
    expect(source).toContain("this.rendererCanvas.tabIndex = -1");
    expect(source).toContain("aria-live=\"polite\"");
    expect(source).toContain("aria-describedby={keyboardInstructionsId}");
    expect(labelBinding).toContain("element.tabIndex = -1");
    expect(labelBinding).not.toContain('addEventListener("focus"');
    expect(source).toContain('this.host.addEventListener("keydown", this.handleKeyDown)');
    expect(source).not.toContain('window.addEventListener("keydown", this.handleKeyDown)');
    expect(keyboard).toContain("if (!detailSourceId) return true");
    expect(keyboard).toContain('return node.kind !== "source"');
    expect(keyboard).toContain("node.sourceId === detailSourceId");
    expect(keyboard).not.toContain("showEventCards");
    expect(keyboard).not.toContain("showEntityCards");
    expect(keyboard).toContain("nextUniverseKeyboardNodeId(");
    expect(keyboard).toContain("this.callbacks.onNodeClick(node.sceneNode)");
    expect(keyboard).not.toMatch(/focusNode\(|focusSource\(|setData\(|fetch\(|api\./);
    expect(keyboard).not.toMatch(/node\.[fxyz]{1,2}\s*=/);
  });

  it("hard-caps nebula proxy budgets on the client", () => {
    const nebula = sourceBetween(
      "private rebuildNebula()",
      "private updateNebulaPositions()",
    );

    expect(nebula).toContain("const budgetCap = mobile ? 1_200 : 3_000");
    expect(nebula).toContain("const budget = Math.min(");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudgetCap");
    expect(nebula).toContain("this.host.dataset.universeNebulaBudget");
  });

  it("snaps the imperceptible detail-morph tail so stable scenes can sleep", () => {
    expect(source).toContain("const DETAIL_MORPH_SETTLE_EPSILON = 0.01");
    expect(source).toContain(
      "Math.abs(nextTarget - nextMix) <= DETAIL_MORPH_SETTLE_EPSILON",
    );
    expect(source).toContain(
      "Math.abs(nextTarget - nextMix) > DETAIL_MORPH_SETTLE_EPSILON",
    );
  });

  it("reports import, initialization, and WebGL context failures once", () => {
    expect(source).toContain(
      'this.rendererCanvas.addEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain(
      'this.rendererCanvas.removeEventListener("webglcontextlost", this.handleWebglContextLost)',
    );
    expect(source).toContain('this.callbacks.onUnavailable("context-lost")');
    expect(source).toContain('notifyUnavailable("dynamic-import")');
    expect(source).toContain('?? "initialization"');
    expect(source).toContain("notifyUnavailable(unavailableReason)");
    expect(source).toContain("Failed to initialize the 3D scene");
    expect(source).toContain("classifyUniverseWebGLContextFailure(reason)");
    expect(source).toContain("console.warn(");
    expect(source).not.toContain("console.error(");
    expect(source).toContain("if (unavailableNotifiedRef.current) return;");
  });
});
