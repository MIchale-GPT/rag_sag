export type UniverseDisplayMode = "normal" | "preview";
export type UniversePreviewDirection = "next" | "previous";

export interface UniversePreviewSession {
  /** Window revision at which this preview journey began. */
  originWindowRevision: number;
  /** Direction away from the session origin; null until the first accepted step. */
  direction: UniversePreviewDirection | null;
  /** Number of accepted timeline steps away from the session origin. */
  depth: number;
}

export interface UniverseDisplayModeState {
  mode: UniverseDisplayMode;
  preview: UniversePreviewSession | null;
  /** Invalidates stale asynchronous wheel plans without coupling to scene state. */
  revision: number;
}

export type UniverseDisplayIntentAction =
  | "enter-preview"
  | "advance-preview"
  | "rewind-preview"
  | "return-normal";

export interface UniverseDisplayIntentPlan {
  action: UniverseDisplayIntentAction;
  timelineDirection: UniversePreviewDirection;
  sourceRevision: number;
  nextState: UniverseDisplayModeState;
}

export type UniverseDisplayIntentOutcome =
  | "shifted"
  | "blocked"
  | "complete"
  | "cancelled";

export interface UniverseNormalVisualPolicy {
  nodeScale: number;
  eventStarScale: number;
  cardScale: number;
  opacity: number;
  linkOpacity: number;
}

export interface UniversePreviewVisualPolicy {
  nearNodeScale: number;
  farNodeScale: number;
  nearEventStarScale: number;
  farEventStarScale: number;
  nearCardScale: number;
  farCardScale: number;
  nearOpacity: number;
  farOpacity: number;
  nearLinkOpacity: number;
  farLinkOpacity: number;
  /** Normalized travel distance away from the camera-facing plane. */
  depthSpan: number;
  /** Normalized package-centre spread at the near and far time boundaries. */
  nearLateralSpread: number;
  farLateralSpread: number;
  verticalAspect: number;
  /** Shapes time distance without changing ordering or endpoints. */
  ageExponent: number;
}

export interface UniverseDisplayVisualPolicy {
  normal: UniverseNormalVisualPolicy;
  preview: UniversePreviewVisualPolicy;
}

export type UniverseDisplayVisualPolicyInput = {
  normal?: Partial<UniverseNormalVisualPolicy>;
  preview?: Partial<UniversePreviewVisualPolicy>;
};

export interface UniverseTemporalBundleInput {
  bundleId: string;
  /** Target time distance: 0 is the active/near package, 1 is farthest. */
  ageProgress: number;
  /** Previous frame's time distance; omitted for an already-settled package. */
  previousAgeProgress?: number;
}

export interface UniverseTemporalBatchOptions {
  mode: UniverseDisplayMode;
  previousMode?: UniverseDisplayMode;
  direction?: UniversePreviewDirection | null;
  /** Shared 0..1 progress. Every package is interpolated in the same frame. */
  transitionProgress?: number;
}

export interface UniverseTemporalBundleProjection {
  bundleId: string;
  ageProgress: number;
  modeProgress: number;
  /** Add this normalized package offset to the scene's stable base layout. */
  normalizedOffset: { x: number; y: number; z: number };
  nodeScale: number;
  eventStarScale: number;
  cardScale: number;
  opacity: number;
  linkOpacity: number;
}

export const DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY: UniverseDisplayVisualPolicy = {
  normal: {
    nodeScale: 1,
    eventStarScale: 1,
    cardScale: 1,
    opacity: 1,
    linkOpacity: 0.62,
  },
  preview: {
    nearNodeScale: 1.08,
    farNodeScale: 0.38,
    nearEventStarScale: 1.18,
    farEventStarScale: 0.3,
    nearCardScale: 1,
    farCardScale: 0.44,
    nearOpacity: 1,
    farOpacity: 0.24,
    nearLinkOpacity: 0.58,
    farLinkOpacity: 0.12,
    depthSpan: 1,
    nearLateralSpread: 0.035,
    farLateralSpread: 0.44,
    verticalAspect: 0.7,
    ageExponent: 1.3,
  },
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function nonNegative(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(0, value as number) : fallback;
}

function positive(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Math.max(Number.EPSILON, value as number) : fallback;
}

function opacity(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? clamp01(value as number) : fallback;
}

function integer(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function smoothstep(value: number) {
  const progress = clamp01(value);
  return progress * progress * (3 - 2 * progress);
}

function lerp(from: number, to: number, progress: number) {
  return from + (to - from) * progress;
}

function canonicalNumber(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function oppositeDirection(
  left: UniversePreviewDirection,
  right: UniversePreviewDirection,
) {
  return left !== right;
}

function normalState(revision: number): UniverseDisplayModeState {
  return { mode: "normal", preview: null, revision };
}

function previewState(
  revision: number,
  preview: UniversePreviewSession,
): UniverseDisplayModeState {
  return { mode: "preview", preview, revision };
}

export function createUniverseDisplayModeState(
  mode: UniverseDisplayMode = "normal",
  windowRevision = 0,
): UniverseDisplayModeState {
  if (mode === "normal") return normalState(0);
  return previewState(0, {
    originWindowRevision: integer(windowRevision),
    direction: null,
    depth: 0,
  });
}

/**
 * Explicit Normal/Preview switch. Switching to preview establishes a new
 * origin without moving data; switching to normal only changes presentation.
 */
export function setUniverseDisplayMode(
  state: UniverseDisplayModeState,
  mode: UniverseDisplayMode,
  windowRevision: number,
): UniverseDisplayModeState {
  if (state.mode === mode) return state;
  if (mode === "normal") return normalState(state.revision + 1);
  return previewState(state.revision + 1, {
    originWindowRevision: integer(windowRevision),
    direction: null,
    depth: 0,
  });
}

/**
 * Plans one explicit button-driven timeline step. Callers commit the candidate only after
 * the virtual window actually shifts, so a cache/network boundary cannot put
 * the UI into a preview state that its data did not reach.
 *
 * Rewinding the last step returns to Normal. A subsequent timeline action in
 * the same direction starts a fresh Preview journey in that direction.
 */
export function planUniverseDisplayTimelineIntent(
  state: UniverseDisplayModeState,
  direction: UniversePreviewDirection,
  windowRevision: number,
): UniverseDisplayIntentPlan {
  const sourceRevision = state.revision;
  const nextRevision = sourceRevision + 1;

  if (state.mode === "normal" || !state.preview) {
    return {
      action: "enter-preview",
      timelineDirection: direction,
      sourceRevision,
      nextState: previewState(nextRevision, {
        originWindowRevision: integer(windowRevision),
        direction,
        depth: 1,
      }),
    };
  }

  const session = state.preview;
  if (session.direction === null || session.depth === 0) {
    return {
      action: "enter-preview",
      timelineDirection: direction,
      sourceRevision,
      nextState: previewState(nextRevision, {
        ...session,
        direction,
        depth: 1,
      }),
    };
  }

  if (!oppositeDirection(session.direction, direction)) {
    return {
      action: "advance-preview",
      timelineDirection: direction,
      sourceRevision,
      nextState: previewState(nextRevision, {
        ...session,
        depth: session.depth + 1,
      }),
    };
  }

  if (session.depth > 1) {
    return {
      action: "rewind-preview",
      timelineDirection: direction,
      sourceRevision,
      nextState: previewState(nextRevision, {
        ...session,
        depth: session.depth - 1,
      }),
    };
  }

  return {
    action: "return-normal",
    timelineDirection: direction,
    sourceRevision,
    nextState: normalState(nextRevision),
  };
}

/** Commits only a successful and non-stale asynchronous timeline movement. */
export function commitUniverseDisplayIntent(
  state: UniverseDisplayModeState,
  plan: UniverseDisplayIntentPlan,
  outcome: UniverseDisplayIntentOutcome,
) {
  if (outcome !== "shifted" || plan.sourceRevision !== state.revision) {
    return state;
  }
  return plan.nextState;
}

/** Rank 0 is active/near; the last rank is the far time boundary. */
export function universeTemporalRankProgress(rank: number, total: number) {
  const count = integer(total);
  if (count <= 1) return 0;
  return clamp01(rank / (count - 1));
}

/**
 * Time-based progress works for either chronological direction. The fallback
 * should normally be rank progress and handles identical or invalid dates.
 */
export function universeTemporalTimestampProgress(
  timestamp: number,
  nearTimestamp: number,
  farTimestamp: number,
  fallback = 0,
) {
  if (
    !Number.isFinite(timestamp)
    || !Number.isFinite(nearTimestamp)
    || !Number.isFinite(farTimestamp)
    || nearTimestamp === farTimestamp
  ) return clamp01(fallback);
  return clamp01(
    (timestamp - nearTimestamp) / (farTimestamp - nearTimestamp),
  );
}

export function resolveUniverseDisplayVisualPolicy(
  input: UniverseDisplayVisualPolicyInput = {},
): UniverseDisplayVisualPolicy {
  const normalDefaults = DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY.normal;
  const previewDefaults = DEFAULT_UNIVERSE_DISPLAY_VISUAL_POLICY.preview;
  const normalInput = input.normal ?? {};
  const previewInput = input.preview ?? {};

  const normal: UniverseNormalVisualPolicy = {
    nodeScale: positive(normalInput.nodeScale, normalDefaults.nodeScale),
    eventStarScale: positive(
      normalInput.eventStarScale,
      normalDefaults.eventStarScale,
    ),
    cardScale: positive(normalInput.cardScale, normalDefaults.cardScale),
    opacity: opacity(normalInput.opacity, normalDefaults.opacity),
    linkOpacity: opacity(normalInput.linkOpacity, normalDefaults.linkOpacity),
  };

  const nearNodeScale = positive(
    previewInput.nearNodeScale,
    previewDefaults.nearNodeScale,
  );
  const nearEventStarScale = positive(
    previewInput.nearEventStarScale,
    previewDefaults.nearEventStarScale,
  );
  const nearCardScale = positive(
    previewInput.nearCardScale,
    previewDefaults.nearCardScale,
  );
  const nearOpacity = opacity(
    previewInput.nearOpacity,
    previewDefaults.nearOpacity,
  );
  const nearLinkOpacity = opacity(
    previewInput.nearLinkOpacity,
    previewDefaults.nearLinkOpacity,
  );
  const nearLateralSpread = nonNegative(
    previewInput.nearLateralSpread,
    previewDefaults.nearLateralSpread,
  );

  return {
    normal,
    preview: {
      nearNodeScale,
      farNodeScale: Math.min(
        nearNodeScale,
        positive(previewInput.farNodeScale, previewDefaults.farNodeScale),
      ),
      nearEventStarScale,
      farEventStarScale: Math.min(
        nearEventStarScale,
        positive(
          previewInput.farEventStarScale,
          previewDefaults.farEventStarScale,
        ),
      ),
      nearCardScale,
      farCardScale: Math.min(
        nearCardScale,
        positive(previewInput.farCardScale, previewDefaults.farCardScale),
      ),
      nearOpacity,
      farOpacity: Math.min(
        nearOpacity,
        opacity(previewInput.farOpacity, previewDefaults.farOpacity),
      ),
      nearLinkOpacity,
      farLinkOpacity: Math.min(
        nearLinkOpacity,
        opacity(previewInput.farLinkOpacity, previewDefaults.farLinkOpacity),
      ),
      depthSpan: nonNegative(previewInput.depthSpan, previewDefaults.depthSpan),
      nearLateralSpread,
      farLateralSpread: Math.max(
        nearLateralSpread,
        nonNegative(
          previewInput.farLateralSpread,
          previewDefaults.farLateralSpread,
        ),
      ),
      verticalAspect: nonNegative(
        previewInput.verticalAspect,
        previewDefaults.verticalAspect,
      ),
      ageExponent: positive(
        previewInput.ageExponent,
        previewDefaults.ageExponent,
      ),
    },
  };
}

function stableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Projects an entire event-package batch with one shared transition clock.
 * No item delay/stagger is introduced: temporal order comes from continuous
 * depth, scale and opacity, while the event and its entities share one offset.
 */
export function projectUniverseTemporalBatch(
  bundles: readonly UniverseTemporalBundleInput[],
  options: UniverseTemporalBatchOptions,
  policyInput: UniverseDisplayVisualPolicyInput = {},
): UniverseTemporalBundleProjection[] {
  const policy = resolveUniverseDisplayVisualPolicy(policyInput);
  const progress = smoothstep(options.transitionProgress ?? 1);
  const fromMode = options.previousMode ?? options.mode;
  const fromModeProgress = fromMode === "preview" ? 1 : 0;
  const toModeProgress = options.mode === "preview" ? 1 : 0;
  const modeProgress = lerp(fromModeProgress, toModeProgress, progress);
  const mirror = options.direction === "previous" ? -1 : 1;

  return bundles.map((bundle) => {
    const targetAge = clamp01(bundle.ageProgress);
    const previousAge = clamp01(bundle.previousAgeProgress ?? targetAge);
    const ageProgress = lerp(previousAge, targetAge, progress);
    const curvedAge = Math.pow(ageProgress, policy.preview.ageExponent);
    const spread = lerp(
      policy.preview.nearLateralSpread,
      policy.preview.farLateralSpread,
      curvedAge,
    );
    const angle = stableUnit(bundle.bundleId) * Math.PI * 2 * mirror;
    const previewOffset = {
      x: Math.cos(angle) * spread,
      y: Math.sin(angle) * spread * policy.preview.verticalAspect,
      z: -policy.preview.depthSpan * curvedAge,
    };
    const previewNodeScale = lerp(
      policy.preview.nearNodeScale,
      policy.preview.farNodeScale,
      curvedAge,
    );
    const previewEventStarScale = lerp(
      policy.preview.nearEventStarScale,
      policy.preview.farEventStarScale,
      curvedAge,
    );
    const previewCardScale = lerp(
      policy.preview.nearCardScale,
      policy.preview.farCardScale,
      curvedAge,
    );
    const previewOpacity = lerp(
      policy.preview.nearOpacity,
      policy.preview.farOpacity,
      curvedAge,
    );
    const previewLinkOpacity = lerp(
      policy.preview.nearLinkOpacity,
      policy.preview.farLinkOpacity,
      curvedAge,
    );

    return {
      bundleId: bundle.bundleId,
      ageProgress,
      modeProgress,
      normalizedOffset: {
        x: canonicalNumber(previewOffset.x * modeProgress),
        y: canonicalNumber(previewOffset.y * modeProgress),
        z: canonicalNumber(previewOffset.z * modeProgress),
      },
      nodeScale: lerp(policy.normal.nodeScale, previewNodeScale, modeProgress),
      eventStarScale: lerp(
        policy.normal.eventStarScale,
        previewEventStarScale,
        modeProgress,
      ),
      cardScale: lerp(policy.normal.cardScale, previewCardScale, modeProgress),
      opacity: lerp(policy.normal.opacity, previewOpacity, modeProgress),
      linkOpacity: lerp(
        policy.normal.linkOpacity,
        previewLinkOpacity,
        modeProgress,
      ),
    };
  });
}
