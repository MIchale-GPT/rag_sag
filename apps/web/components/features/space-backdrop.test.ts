import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const backdropSource = readFileSync(
  new URL("./space-backdrop.tsx", import.meta.url),
  "utf8",
);
const particlesSource = readFileSync(
  new URL("./space-particles.tsx", import.meta.url),
  "utf8",
);

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("space backdrop performance policy", () => {
  it("pauses ambient canvas loops once the graph becomes the active visual layer", () => {
    expect(backdropSource).toContain("const ambientMotionPausedRef = React.useRef(");
    expect(backdropSource).toContain(
      'view.mode === "detail" || view.progress >= 0.18',
    );
    expect(backdropSource).toContain(
      "<SpaceParticles reducedMotion={Boolean(reducedMotion) || ambientMotionPaused}",
    );
    expect(backdropSource).toContain(
      "<ParticleGalaxy reducedMotion={Boolean(reducedMotion) || ambientMotionPaused}",
    );
    expect(particlesSource).toContain("autoPlay: !reducedMotion");
  });

  it("coalesces cursor meteor work to one animation frame without per-event layout reads", () => {
    const pointerMove = sourceBetween(
      backdropSource,
      "const handlePointerMove = (event: PointerEvent) =>",
      "const resizeObserver = new ResizeObserver(measureField)",
    );
    expect(backdropSource).toContain("let fieldBounds = field.getBoundingClientRect()");
    expect(backdropSource).toContain("const measureField = () =>");
    expect(pointerMove).toContain("fieldBounds.left");
    expect(pointerMove).toContain("window.requestAnimationFrame(renderMeteor)");
    expect(pointerMove).not.toContain("getBoundingClientRect()");
    expect(backdropSource).toContain("window.cancelAnimationFrame(animationFrame)");
  });
});
