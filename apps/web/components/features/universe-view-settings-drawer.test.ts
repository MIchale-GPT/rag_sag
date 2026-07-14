import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const drawerSource = readFileSync(
  new URL("./universe-view-settings-drawer.tsx", import.meta.url),
  "utf8",
);
const panelSource = readFileSync(
  new URL("./universe-view-settings-panel.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("./app-shell.tsx", import.meta.url),
  "utf8",
);
const petSource = readFileSync(
  new URL("./pet.tsx", import.meta.url),
  "utf8",
);
const sheetSource = readFileSync(
  new URL("../ui/sheet.tsx", import.meta.url),
  "utf8",
);
const zh = JSON.parse(readFileSync(
  new URL("../../messages/zh-CN.json", import.meta.url),
  "utf8",
));
const en = JSON.parse(readFileSync(
  new URL("../../messages/en-US.json", import.meta.url),
  "utf8",
));

describe("universe view settings drawer", () => {
  it("places the settings trigger immediately before exit in the explore controls", () => {
    const controls = appShellSource.slice(
      appShellSource.indexOf('data-explore-controls="true"'),
      appShellSource.indexOf("</motion.div>", appShellSource.indexOf('data-explore-controls="true"')),
    );

    expect(appShellSource).toContain('import { Grip, Settings2 } from "lucide-react"');
    expect(appShellSource).toContain(
      'className="fixed right-4 top-3 z-[45] flex items-center gap-2"',
    );
    expect(petSource).toContain('sag-pet-shell group/pet fixed z-40');
    expect(sheetSource).toContain("fixed inset-0 z-50");
    expect(controls).toContain("<Settings2");
    expect(controls.indexOf("<UniverseViewSettingsDrawer"))
      .toBeLessThan(controls.indexOf("onClick={exitExploreMode}"));
  });

  it("uses one responsive sheet with a light graph-preserving overlay", () => {
    expect(drawerSource).toContain("const mobile = useIsMobile()");
    expect(drawerSource).toContain('side={mobile ? "bottom" : "right"}');
    expect(drawerSource).toContain('overlayClassName="bg-black/30 backdrop-blur-[1px]"');
    expect(drawerSource).toContain("h-[82svh]");
    expect(drawerSource).toContain("w-[420px]");
    expect(drawerSource).toContain("flex flex-col gap-0 overflow-hidden");
    expect(drawerSource).toContain("min-h-0 flex-1 overflow-y-auto");
  });

  it("reuses the canonical preferences and settings panel without parallel state", () => {
    expect(drawerSource).toContain("useUniverseViewPreferences()");
    expect(drawerSource).toContain("useUniverseEntityCategories()");
    expect(drawerSource).toContain("<UniverseViewSettings");
    expect(drawerSource).toContain("compact");
    expect(drawerSource).toContain("isMobile={mobile}");
    expect(drawerSource).not.toContain("useState(");
  });

  it("keeps the shared panel single-column inside the narrow drawer", () => {
    expect(panelSource).toContain("compact?: boolean;");
    expect(panelSource).toContain("compact = false");
    expect(panelSource).toContain("data-settings-compact={compact}");
    expect(panelSource).toContain('!compact && "sm:grid-cols-2"');
    expect(panelSource).not.toContain("<Select");
    expect(panelSource).not.toContain("priority");
    expect(panelSource).not.toContain("edgeDensity");
    expect(panelSource).not.toContain("labelDensity");
  });

  it("configures cards without hiding graph nodes", () => {
    expect(panelSource).toContain("normalized.showEventCards");
    expect(panelSource).toContain("normalized.showEntityCards");
    expect(panelSource).toContain("showEventCards: value === true");
    expect(panelSource).toContain("showEntityCards: value === true");
    expect(panelSource).not.toContain("visibleKinds");
  });

  it("keeps the explicit entity-category filter without allowing an empty selection", () => {
    expect(drawerSource).toContain("useUniverseEntityCategories()");
    expect(panelSource).toContain("entityCategories: string[]");
    expect(panelSource).toContain("if (next.size <= 1) return");
    expect(panelSource).toContain("disabled={lastSelected}");
  });

  it("configures a larger visible bundle window and bounded capacity", () => {
    expect(panelSource).toContain('title={t("visibleEventBundles.title")}');
    expect(panelSource).toContain('title={t("cachedEventBundles.title")}');
    expect(panelSource).toContain("UNIVERSE_VIEW_LIMITS.visibleEventBundles");
    expect(panelSource).toContain("UNIVERSE_VIEW_LIMITS.cachedEventBundles");
    expect(panelSource).toContain("minimumUniverseCacheBundles");
    expect(panelSource).toContain(
      "min={minimumUniverseCacheBundles(draftWindow.visibleEventBundles)}",
    );
    expect(panelSource).toContain(
      "visibleEventBundles: current.visibleEventBundles",
    );
    expect(panelSource).not.toContain(
      "visibleEventBundles: effectiveWindow.visibleEventBundles,\n                  cachedEventBundles: value",
    );
    expect(panelSource).not.toContain(
      "visibleEventBundles: value,\n                  cachedEventBundles:",
    );
  });

  it("shows and edits device-effective mobile bundle limits", () => {
    expect(panelSource).toContain("isMobile?: boolean;");
    expect(panelSource).toContain("const detectedMobile = useIsMobile()");
    expect(panelSource).toContain("const mobile = isMobile ?? detectedMobile");
    expect(panelSource).toContain("effectiveUniverseBundleWindow(normalized, mobile)");
    expect(panelSource).toContain("UNIVERSE_VIEW_LIMITS.deviceBundleCaps.mobile");
    expect(panelSource).toContain("max={deviceCaps.visible}");
    expect(panelSource).toContain("max={deviceCaps.cached}");
    expect(panelSource).toContain(
      'data-settings-device={mobile ? "mobile" : "desktop"}',
    );
    expect(panelSource).toContain(
      "data-effective-visible-bundles={effectiveWindow.visibleEventBundles}",
    );
    expect(panelSource).toContain(
      "data-effective-cached-bundles={effectiveWindow.cachedEventBundles}",
    );
  });

  it("adds optional sheet customization without changing shared defaults", () => {
    expect(sheetSource).toContain("overlayClassName?: string");
    expect(sheetSource).toContain("closeLabel?: string");
    expect(sheetSource).toContain('closeLabel = "Close"');
    expect(sheetSource).toContain("<SheetOverlay className={overlayClassName} />");
    expect(sheetSource).toContain("flex size-10 items-center justify-center");
    expect(sheetSource).toContain("motion-reduce:animate-none");
  });

  it("keeps drawer and trigger copy synchronized across locales", () => {
    expect(zh.AppShell.graphSettings).toBeTruthy();
    expect(en.AppShell.graphSettings).toBeTruthy();
    expect(zh.GraphSettings.drawer.title).toBeTruthy();
    expect(en.GraphSettings.drawer.title).toBeTruthy();
    expect(zh.GraphSettings.drawer.description).toBeTruthy();
    expect(en.GraphSettings.drawer.description).toBeTruthy();
    expect(zh.GraphSettings.visibleEventBundles.title).toBeTruthy();
    expect(en.GraphSettings.visibleEventBundles.title).toBeTruthy();
    expect(zh.GraphSettings.cachedEventBundles.title).toBeTruthy();
    expect(en.GraphSettings.cachedEventBundles.title).toBeTruthy();
    expect(zh.GraphSettings.visibleEventBundles.current).toContain("配置上限");
    expect(en.GraphSettings.visibleEventBundles.current).toContain("upper limit");
    expect(zh.GraphSettings.visibleEventBundles.title).toContain("时间");
    expect(en.GraphSettings.visibleEventBundles.title).toContain("time");
    expect(zh.GraphSettings.visibleEventBundles.description).toContain("边缘自然进出");
    expect(en.GraphSettings.visibleEventBundles.description).toContain(
      "retires naturally at the edge",
    );
    expect(zh.GraphSettings.cachedEventBundles.description).toContain("相邻时间");
    expect(en.GraphSettings.cachedEventBundles.description).toContain("Adjacent times");
    expect(JSON.stringify(zh.GraphSettings)).not.toContain("事件包");
    expect(JSON.stringify(en.GraphSettings).toLowerCase()).not.toContain("event bundle");
    expect(zh.GraphSettings.cards.event.title).toBeTruthy();
    expect(en.GraphSettings.cards.entity.title).toBeTruthy();
    expect(zh.GraphSettings.entityTypes.description).toContain("实体及其事项连线一起隐藏");
    expect(en.GraphSettings.entityTypes.description).toContain(
      "entities and their event links hide together",
    );
  });
});
