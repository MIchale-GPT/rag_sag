import { describe, expect, it } from "vitest";

import {
  planUniverseTimelinePrefetch,
  recommendedUniverseTimelineCacheLimit,
  type UniverseTimelinePrefetchInput,
} from "./universe-timeline-prefetch";

function input(
  overrides: Partial<UniverseTimelinePrefetchInput> = {},
): UniverseTimelinePrefetchInput {
  return {
    cacheLength: 6,
    activeIndex: 5,
    visibleLimit: 6,
    cacheLimit: 24,
    hasOlder: true,
    hasNewer: false,
    pageSize: 6,
    preferredDirection: "older",
    ...overrides,
  };
}

describe("universe timeline bidirectional prefetch policy", () => {
  it("budgets the visible scene plus one history and two ahead pages", () => {
    expect(recommendedUniverseTimelineCacheLimit(6, 6)).toBe(24);
    expect(recommendedUniverseTimelineCacheLimit(8, 6)).toBe(26);
  });

  it("fills two pages ahead at the true newest boundary", () => {
    const first = planUniverseTimelinePrefetch(input());
    expect(first).toMatchObject({
      direction: "older",
      reason: "fill-ahead",
      runways: {
        history: 0,
        ahead: 0,
        historyTarget: 0,
        aheadTarget: 12,
        projectedEvictions: 0,
      },
    });

    const onePageReady = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      activeIndex: 5,
    }));
    expect(onePageReady.direction).toBe("older");

    const twoPagesReady = planUniverseTimelinePrefetch(input({
      cacheLength: 18,
      activeIndex: 5,
    }));
    expect(twoPagesReady).toMatchObject({
      direction: null,
      reason: "runways-ready",
      runways: { ahead: 12 },
    });
  });

  it("uses the recent direction when both non-full targets are deficient", () => {
    const base = {
      cacheLength: 8,
      activeIndex: 3,
      hasNewer: true,
      hasOlder: true,
    };
    expect(planUniverseTimelinePrefetch(input({
      ...base,
      preferredDirection: "older",
    }))).toMatchObject({
      direction: "older",
      reason: "both-deficient-preferred-older",
    });
    expect(planUniverseTimelinePrefetch(input({
      ...base,
      preferredDirection: "newer",
    }))).toMatchObject({
      direction: "newer",
      reason: "both-deficient-preferred-newer",
    });
  });

  it("loads older at the full-cache low watermark only when history can retire", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 24,
      activeIndex: 18,
      hasNewer: true,
    }));
    expect(plan).toMatchObject({
      direction: "older",
      reason: "older-low-water",
      runways: {
        history: 13,
        ahead: 5,
        projectedEvictions: 6,
        olderEvictionSafe: true,
      },
    });
  });

  it("loads newer at the full-cache low watermark only when ahead can retire", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 24,
      activeIndex: 8,
      hasNewer: true,
      preferredDirection: "newer",
    }));
    expect(plan).toMatchObject({
      direction: "newer",
      reason: "newer-low-water",
      runways: {
        history: 3,
        ahead: 15,
        projectedEvictions: 6,
        newerEvictionSafe: true,
      },
    });
  });

  it("rejects an older page that would cut into the visible window", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      cacheLimit: 12,
      activeIndex: 6,
      hasNewer: true,
      preferredDirection: "older",
    }));
    expect(plan).toMatchObject({
      direction: null,
      reason: "unsafe-older-eviction",
      runways: {
        history: 1,
        ahead: 5,
        projectedEvictions: 6,
        olderEvictionSafe: false,
      },
    });
  });

  it("rejects a newer page that would cut into prepared ahead data", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      cacheLimit: 12,
      activeIndex: 7,
      hasNewer: true,
      preferredDirection: "newer",
    }));
    expect(plan).toMatchObject({
      direction: null,
      reason: "unsafe-newer-eviction",
      runways: {
        history: 2,
        ahead: 4,
        projectedEvictions: 6,
        newerEvictionSafe: false,
      },
    });
  });

  it("falls back to the only safely evictable side when both are deficient", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 11,
      cacheLimit: 14,
      activeIndex: 5,
      visibleLimit: 4,
      hasNewer: true,
      preferredDirection: "older",
    }));
    expect(plan).toMatchObject({
      direction: "newer",
      reason: "both-deficient-safe-fallback-newer",
      runways: {
        history: 2,
        ahead: 5,
        projectedEvictions: 3,
        olderEvictionSafe: false,
        newerEvictionSafe: true,
      },
    });
  });

  it("does not oscillate when capacity can retain only one low-water page", () => {
    const favorOlder = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      cacheLimit: 12,
      activeIndex: 5,
      hasNewer: true,
      preferredDirection: "older",
    }));
    expect(favorOlder).toMatchObject({
      direction: null,
      reason: "capacity-starved-preferred-ready",
      runways: { history: 0, ahead: 6 },
    });

    const switchToNewer = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      cacheLimit: 12,
      activeIndex: 5,
      hasNewer: true,
      preferredDirection: "newer",
    }));
    expect(switchToNewer.direction).toBe("newer");

    const newerReady = planUniverseTimelinePrefetch(input({
      cacheLength: 12,
      cacheLimit: 12,
      activeIndex: 11,
      hasNewer: true,
      preferredDirection: "newer",
    }));
    expect(newerReady).toMatchObject({
      direction: null,
      reason: "capacity-starved-preferred-ready",
      runways: { history: 6, ahead: 0 },
    });
  });

  it("stops when neither deficient side has a safe eviction runway", () => {
    const plan = planUniverseTimelinePrefetch(input({
      cacheLength: 11,
      cacheLimit: 12,
      visibleLimit: 6,
      activeIndex: 7,
      hasNewer: true,
      preferredDirection: "older",
    }));
    expect(plan).toMatchObject({
      direction: null,
      reason: "unsafe-both-evictions",
      runways: {
        history: 2,
        ahead: 3,
        projectedEvictions: 5,
      },
    });
  });

  it("reports terminal and invalid anchors without requesting", () => {
    expect(planUniverseTimelinePrefetch(input({
      hasOlder: false,
      hasNewer: false,
    }))).toMatchObject({ direction: null, reason: "timeline-exhausted" });
    expect(planUniverseTimelinePrefetch(input({
      activeIndex: 6,
    }))).toMatchObject({ direction: null, reason: "active-out-of-range" });
    expect(planUniverseTimelinePrefetch(input({
      cacheLength: 0,
      activeIndex: -1,
    }))).toMatchObject({ direction: null, reason: "cache-empty" });
  });
});
