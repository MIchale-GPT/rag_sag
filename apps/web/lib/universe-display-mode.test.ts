import { describe, expect, it } from "vitest";

import {
  commitUniverseDisplayIntent,
  createUniverseDisplayModeState,
  planUniverseDisplayTimelineIntent,
  projectUniverseTemporalBatch,
  resolveUniverseDisplayVisualPolicy,
  setUniverseDisplayMode,
  universeTemporalRankProgress,
  universeTemporalTimestampProgress,
} from "./universe-display-mode";

function accepted(
  state: ReturnType<typeof createUniverseDisplayModeState>,
  direction: "next" | "previous",
  windowRevision: number,
) {
  const plan = planUniverseDisplayTimelineIntent(
    state,
    direction,
    windowRevision,
  );
  return {
    plan,
    state: commitUniverseDisplayIntent(state, plan, "shifted"),
  };
}

describe("universe normal/preview state machine", () => {
  it("enters preview directly on the first accepted time-navigation step", () => {
    const initial = createUniverseDisplayModeState();
    const result = accepted(initial, "next", 12);

    expect(result.plan.action).toBe("enter-preview");
    expect(result.state).toEqual({
      mode: "preview",
      preview: {
        originWindowRevision: 12,
        direction: "next",
        depth: 1,
      },
      revision: 1,
    });
  });

  it("rewinds to the session origin and settles into normal mode", () => {
    let state = createUniverseDisplayModeState();
    state = accepted(state, "next", 5).state;
    state = accepted(state, "next", 6).state;
    const firstRewind = accepted(state, "previous", 7);

    expect(firstRewind.plan.action).toBe("rewind-preview");
    expect(firstRewind.state.preview?.depth).toBe(1);

    const origin = accepted(firstRewind.state, "previous", 8);
    expect(origin.plan.action).toBe("return-normal");
    expect(origin.state.mode).toBe("normal");
    expect(origin.state.preview).toBeNull();
  });

  it("starts a fresh reverse preview after crossing normal", () => {
    let state = accepted(createUniverseDisplayModeState(), "next", 1).state;
    state = accepted(state, "previous", 2).state;
    expect(state.mode).toBe("normal");

    const reverse = accepted(state, "previous", 3);
    expect(reverse.plan.action).toBe("enter-preview");
    expect(reverse.state.preview).toMatchObject({
      originWindowRevision: 3,
      direction: "previous",
      depth: 1,
    });
  });

  it("does not commit a blocked, complete, cancelled, or stale movement", () => {
    const state = createUniverseDisplayModeState();
    const plan = planUniverseDisplayTimelineIntent(state, "next", 4);

    for (const outcome of ["blocked", "complete", "cancelled"] as const) {
      expect(commitUniverseDisplayIntent(state, plan, outcome)).toBe(state);
    }

    const manuallyChanged = setUniverseDisplayMode(state, "preview", 4);
    expect(commitUniverseDisplayIntent(
      manuallyChanged,
      plan,
      "shifted",
    )).toBe(manuallyChanged);
  });

  it("supports an explicit presentation switch without moving the window", () => {
    const normal = createUniverseDisplayModeState();
    const preview = setUniverseDisplayMode(normal, "preview", 27);

    expect(preview.preview).toEqual({
      originWindowRevision: 27,
      direction: null,
      depth: 0,
    });
    expect(setUniverseDisplayMode(preview, "normal", 27)).toMatchObject({
      mode: "normal",
      preview: null,
      revision: 2,
    });
  });
});

describe("universe temporal presentation", () => {
  it("normalizes rank and actual time in either chronological direction", () => {
    expect([0, 1, 2, 3].map((rank) =>
      universeTemporalRankProgress(rank, 4))).toEqual([
      0,
      1 / 3,
      2 / 3,
      1,
    ]);
    expect(universeTemporalTimestampProgress(800, 1000, 600)).toBe(0.5);
    expect(universeTemporalTimestampProgress(800, 600, 1000)).toBe(0.5);
    expect(universeTemporalTimestampProgress(800, 800, 800, 0.75)).toBe(0.75);
  });

  it("keeps normal mode flat, equally scaled, opaque, and stably connected", () => {
    const projections = projectUniverseTemporalBatch([
      { bundleId: "near", ageProgress: 0 },
      { bundleId: "middle", ageProgress: 0.5 },
      { bundleId: "far", ageProgress: 1 },
    ], { mode: "normal" });

    projections.forEach((projection) => {
      expect(projection.normalizedOffset).toEqual({ x: 0, y: 0, z: 0 });
      expect(projection.nodeScale).toBe(1);
      expect(projection.eventStarScale).toBe(1);
      expect(projection.cardScale).toBe(1);
      expect(projection.opacity).toBe(1);
      expect(projection.linkOpacity).toBe(0.62);
    });
  });

  it("makes near packages larger and far packages smaller without hiding them", () => {
    const [near, middle, far] = projectUniverseTemporalBatch([
      { bundleId: "near", ageProgress: 0 },
      { bundleId: "middle", ageProgress: 0.5 },
      { bundleId: "far", ageProgress: 1 },
    ], { mode: "preview", direction: "next" });

    expect(near.nodeScale).toBeGreaterThan(middle.nodeScale);
    expect(middle.nodeScale).toBeGreaterThan(far.nodeScale);
    expect(near.eventStarScale).toBeGreaterThan(middle.eventStarScale);
    expect(middle.eventStarScale).toBeGreaterThan(far.eventStarScale);
    expect(near.cardScale).toBeGreaterThan(far.cardScale);
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(far.opacity).toBeGreaterThan(0);
    expect(near.normalizedOffset.z).toBe(0);
    expect(far.normalizedOffset.z).toBe(-1);
  });

  it("interpolates the entire batch on one clock instead of staggering items", () => {
    const input = [
      { bundleId: "a", previousAgeProgress: 1, ageProgress: 0.6 },
      { bundleId: "b", previousAgeProgress: 0.7, ageProgress: 0.3 },
      { bundleId: "c", previousAgeProgress: 0.4, ageProgress: 0 },
    ];
    const start = projectUniverseTemporalBatch(input, {
      mode: "preview",
      transitionProgress: 0,
    });
    const middle = projectUniverseTemporalBatch(input, {
      mode: "preview",
      transitionProgress: 0.5,
    });
    const end = projectUniverseTemporalBatch(input, {
      mode: "preview",
      transitionProgress: 1,
    });

    middle.forEach((projection, index) => {
      expect(projection.ageProgress).toBeLessThan(start[index].ageProgress);
      expect(projection.ageProgress).toBeGreaterThan(end[index].ageProgress);
    });
    expect(start).toHaveLength(3);
    expect(middle).toHaveLength(3);
    expect(end).toHaveLength(3);
  });

  it("smoothly blends between stable normal layout and temporal preview", () => {
    const input = [{ bundleId: "far", ageProgress: 1 }];
    const start = projectUniverseTemporalBatch(input, {
      previousMode: "normal",
      mode: "preview",
      transitionProgress: 0,
    })[0];
    const middle = projectUniverseTemporalBatch(input, {
      previousMode: "normal",
      mode: "preview",
      transitionProgress: 0.5,
    })[0];
    const end = projectUniverseTemporalBatch(input, {
      previousMode: "normal",
      mode: "preview",
      transitionProgress: 1,
    })[0];

    expect(start.modeProgress).toBe(0);
    expect(middle.modeProgress).toBe(0.5);
    expect(end.modeProgress).toBe(1);
    expect(start.nodeScale).toBe(1);
    expect(middle.nodeScale).toBeLessThan(start.nodeScale);
    expect(middle.nodeScale).toBeGreaterThan(end.nodeScale);
    expect(middle.normalizedOffset.z).toBe(-0.5);
  });

  it("uses a deterministic package lane and mirrors it for reverse preview", () => {
    const input = [{ bundleId: "event-package", ageProgress: 0.8 }];
    const forward = projectUniverseTemporalBatch(input, {
      mode: "preview",
      direction: "next",
    })[0];
    const repeated = projectUniverseTemporalBatch(input, {
      mode: "preview",
      direction: "next",
    })[0];
    const reverse = projectUniverseTemporalBatch(input, {
      mode: "preview",
      direction: "previous",
    })[0];

    expect(repeated.normalizedOffset).toEqual(forward.normalizedOffset);
    expect(reverse.normalizedOffset.x).toBeCloseTo(forward.normalizedOffset.x);
    expect(reverse.normalizedOffset.y).toBeCloseTo(-forward.normalizedOffset.y);
    expect(reverse.normalizedOffset.z).toBe(forward.normalizedOffset.z);
  });

  it("normalizes custom policy while preserving near/far visual invariants", () => {
    const policy = resolveUniverseDisplayVisualPolicy({
      normal: { opacity: 4, linkOpacity: -1 },
      preview: {
        nearNodeScale: 0.8,
        farNodeScale: 2,
        nearOpacity: 0.7,
        farOpacity: 0.9,
        nearLateralSpread: 0.5,
        farLateralSpread: 0.1,
      },
    });

    expect(policy.normal.opacity).toBe(1);
    expect(policy.normal.linkOpacity).toBe(0);
    expect(policy.preview.farNodeScale).toBe(0.8);
    expect(policy.preview.farOpacity).toBe(0.7);
    expect(policy.preview.farLateralSpread).toBe(0.5);
  });
});
