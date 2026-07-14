import { describe, expect, it } from "vitest";

import {
  resolveUniverseDetailSource,
  universeCardMorph,
  universeDeepLoadMilestone,
  universeVisualDetailProgress,
} from "./universe-presentation";

describe("universe presentation state", () => {
  it("enters detail only at the near threshold", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: "source-a",
      candidateRadiusPx: 179,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBeNull();
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: "source-a",
      candidateRadiusPx: 180,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
  });

  it("keeps the activated source through orbit, pan, and ordinary zoom", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 116,
      candidateSourceId: "source-b",
      candidateRadiusPx: 220,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 116,
      candidateSourceId: null,
      candidateRadiusPx: null,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-a");
  });

  it("returns the whole source to overview only at the exit threshold", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 72,
      candidateSourceId: "source-a",
      candidateRadiusPx: 72,
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBeNull();
  });

  it("lets an explicit node focus establish its source immediately", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: null,
      currentRadiusPx: null,
      candidateSourceId: null,
      candidateRadiusPx: null,
      explicitSourceId: "source-b",
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-b");
  });

  it("lets an explicit source switch replace the previous detail latch", () => {
    expect(resolveUniverseDetailSource({
      currentSourceId: "source-a",
      currentRadiusPx: 240,
      candidateSourceId: "source-a",
      candidateRadiusPx: 240,
      explicitSourceId: "source-b",
      enterRadiusPx: 180,
      exitRadiusPx: 72,
    })).toBe("source-b");
  });

  it("uses coarse deep-zoom milestones instead of individual wheel gestures", () => {
    expect(universeDeepLoadMilestone(359, 360, 24)).toBe(0);
    expect(universeDeepLoadMilestone(360, 360, 24)).toBe(1);
    expect(universeDeepLoadMilestone(470, 360, 24)).toBe(1);
    expect(universeDeepLoadMilestone(500, 360, 24)).toBe(2);
  });

  it("morphs continuously from orbit stars through near cards to full cards", () => {
    const radii = [72, 108, 144, 180, 234, 288, 360];
    const progress = radii.map((radius) =>
      universeVisualDetailProgress(radius, 72, 180, 360));

    expect(progress[0]).toBe(0);
    expect(progress[3]).toBeCloseTo(0.5, 5);
    expect(progress[5]).toBe(1);
    expect(progress[6]).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("reveals a compact title card before its metadata and summary", () => {
    const star = universeCardMorph(0);
    const compact = universeCardMorph(0.5);
    const full = universeCardMorph(1);

    expect(star).toEqual({ reveal: 0, scale: 0.32, eyebrow: 0, summary: 0 });
    expect(compact.reveal).toBe(1);
    expect(compact.scale).toBeCloseTo(0.66, 5);
    expect(compact.eyebrow).toBeGreaterThan(0);
    expect(compact.summary).toBe(0);
    expect(full).toEqual({ reveal: 1, scale: 1, eyebrow: 1, summary: 1 });
  });
});
