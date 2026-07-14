export interface UniverseDetailLatchInput {
  currentSourceId: string | null;
  currentRadiusPx: number | null;
  candidateSourceId: string | null;
  candidateRadiusPx: number | null;
  explicitSourceId?: string | null;
  enterRadiusPx: number;
  exitRadiusPx: number;
}

export interface UniverseCardMorph {
  reveal: number;
  scale: number;
  eyebrow: number;
  summary: number;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value: number) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Keeps one source in detail mode until the camera crosses the overview
 * boundary. Candidate changes caused by panning or orbiting are deliberately
 * ignored while the current source remains above that boundary.
 */
export function resolveUniverseDetailSource({
  currentSourceId,
  currentRadiusPx,
  candidateSourceId,
  candidateRadiusPx,
  explicitSourceId,
  enterRadiusPx,
  exitRadiusPx,
}: UniverseDetailLatchInput) {
  if (explicitSourceId) return explicitSourceId;

  if (
    currentSourceId
    && currentRadiusPx !== null
    && Number.isFinite(currentRadiusPx)
    && currentRadiusPx > exitRadiusPx
  ) {
    return currentSourceId;
  }

  if (
    candidateSourceId
    && candidateRadiusPx !== null
    && Number.isFinite(candidateRadiusPx)
    && candidateRadiusPx >= enterRadiusPx
  ) {
    return candidateSourceId;
  }

  return null;
}

/**
 * Converts deep zoom into coarse, monotonic loading milestones. Re-entering a
 * milestone that was already visited must not request another page.
 */
export function universeDeepLoadMilestone(
  radiusPx: number,
  deepRadiusPx: number,
  hysteresisPx: number,
) {
  if (!Number.isFinite(radiusPx) || radiusPx < deepRadiusPx) return 0;
  const step = Math.max(96, hysteresisPx * 4, deepRadiusPx * 0.34);
  return 1 + Math.floor((radiusPx - deepRadiusPx) / step);
}

/**
 * Maps projected source size to a continuous visual morph. `nearRadiusPx`
 * remains the semantic detail latch, but lands halfway through the visual
 * transition; the card reaches full size before deep-loading begins.
 */
export function universeVisualDetailProgress(
  radiusPx: number | null,
  orbitRadiusPx: number,
  nearRadiusPx: number,
  deepRadiusPx: number,
) {
  if (radiusPx === null || !Number.isFinite(radiusPx)) return 0;
  const start = Math.max(0, orbitRadiusPx);
  const near = Math.max(start + 1, nearRadiusPx);
  const deep = Math.max(near + 1, deepRadiusPx);
  const full = near + (deep - near) * 0.6;
  return smoothstep((radiusPx - start) / Math.max(1, full - start));
}

/**
 * Separates card chrome, scale, metadata, and summary reveal so zooming reads
 * as one object gaining information density instead of a full card popping in.
 */
export function universeCardMorph(progress: number): UniverseCardMorph {
  const value = clamp01(progress);
  return {
    reveal: smoothstep((value - 0.025) / 0.4),
    scale: 0.32 + smoothstep(value) * 0.68,
    eyebrow: smoothstep((value - 0.16) / 0.52),
    summary: smoothstep((value - 0.52) / 0.43),
  };
}
