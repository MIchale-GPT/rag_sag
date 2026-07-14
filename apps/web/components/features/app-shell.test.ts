import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const appShellSource = readFileSync(
  new URL("./app-shell.tsx", import.meta.url),
  "utf8",
);

describe("app shell viewport stage", () => {
  it("pins the universe stage to the visible viewport instead of content height", () => {
    const stageStart = appShellSource.indexOf("<DetailPanelProvider>");
    const backdropStart = appShellSource.indexOf("<SpaceBackdrop />", stageStart);
    const stageOpening = appShellSource.slice(stageStart, backdropStart);

    expect(stageStart).toBeGreaterThanOrEqual(0);
    expect(backdropStart).toBeGreaterThan(stageStart);
    expect(stageOpening).toContain(
      '"bg-space-field relative grid h-svh min-h-0 overflow-hidden"',
    );
    expect(stageOpening).not.toContain(
      '"bg-space-field relative grid min-h-svh overflow-hidden"',
    );
  });
});
