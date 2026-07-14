"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { SettingsRow, SettingsSection } from "@/components/features/settings-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  UNIVERSE_VIEW_LIMITS,
  effectiveUniverseBundleWindow,
  minimumUniverseCacheBundles,
  normalizeUniverseViewPreferences,
  type UniverseViewPreferences,
} from "@/lib/universe-view-preferences";
import { cn } from "@/lib/utils";

export interface UniverseViewSettingsProps {
  preferences: UniverseViewPreferences;
  onChange: (preferences: UniverseViewPreferences) => void;
  onReset: () => void;
  entityCategories: string[];
  compact?: boolean;
  isMobile?: boolean;
}

export function UniverseViewSettings({
  preferences,
  onChange,
  onReset,
  entityCategories,
  compact = false,
  isMobile,
}: UniverseViewSettingsProps) {
  const locale = useLocale();
  const t = useTranslations("GraphSettings");
  const detectedMobile = useIsMobile();
  const mobile = isMobile ?? detectedMobile;
  const normalized = React.useMemo(
    () => normalizeUniverseViewPreferences(preferences),
    [preferences],
  );
  const effectiveWindow = React.useMemo(
    () => effectiveUniverseBundleWindow(normalized, mobile),
    [mobile, normalized],
  );
  const deviceCaps = mobile
    ? UNIVERSE_VIEW_LIMITS.deviceBundleCaps.mobile
    : UNIVERSE_VIEW_LIMITS.deviceBundleCaps.desktop;
  const [draftWindow, setDraftWindow] = React.useState(() => ({
    visibleEventBundles: effectiveWindow.visibleEventBundles,
    cachedEventBundles: effectiveWindow.cachedEventBundles,
  }));

  React.useEffect(() => {
    setDraftWindow({
      visibleEventBundles: effectiveWindow.visibleEventBundles,
      cachedEventBundles: effectiveWindow.cachedEventBundles,
    });
  }, [effectiveWindow.cachedEventBundles, effectiveWindow.visibleEventBundles]);

  const availableCategories = React.useMemo(() => {
    const selected = normalized.entityCategories ?? [];
    return [...new Set([...entityCategories, ...selected]
      .map((category) => category.trim())
      .filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, locale));
  }, [entityCategories, locale, normalized.entityCategories]);

  const emit = React.useCallback((patch: Partial<UniverseViewPreferences>) => {
    onChange(normalizeUniverseViewPreferences({ ...normalized, ...patch }));
  }, [normalized, onChange]);

  const toggleCategory = React.useCallback((category: string, checked: boolean) => {
    const next = new Set(normalized.entityCategories ?? availableCategories);
    if (checked) next.add(category);
    else {
      if (next.size <= 1) return;
      next.delete(category);
    }
    const selected = availableCategories.filter((item) => next.has(item));
    emit({
      entityCategories: selected.length === availableCategories.length
        ? null
        : selected,
    });
  }, [availableCategories, emit, normalized.entityCategories]);

  const allCategoriesSelected = normalized.entityCategories === null;
  const selectedCategoryCount = normalized.entityCategories?.length
    ?? availableCategories.length;

  return (
    <div
      className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}
      data-settings-section="graph"
      data-settings-compact={compact}
      data-settings-device={mobile ? "mobile" : "desktop"}
      data-effective-visible-bundles={effectiveWindow.visibleEventBundles}
      data-effective-cached-bundles={effectiveWindow.cachedEventBundles}
    >
      <SettingsSection
        title={t("cards.title")}
        description={t("cards.description")}
      >
        <SettingsRow
          title={t("cards.event.title")}
          description={t("cards.event.description")}
          layout="inline"
          className={cn(compact && "sm:flex-row sm:items-center")}
        >
          <Checkbox
            aria-label={t("cards.event.aria")}
            checked={normalized.showEventCards}
            onCheckedChange={(value) => emit({ showEventCards: value === true })}
          />
        </SettingsRow>
        <SettingsRow
          title={t("cards.entity.title")}
          description={t("cards.entity.description")}
          layout="inline"
          className={cn(compact && "sm:flex-row sm:items-center")}
        >
          <Checkbox
            aria-label={t("cards.entity.aria")}
            checked={normalized.showEntityCards}
            onCheckedChange={(value) => emit({ showEntityCards: value === true })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("entityTypes.title")}
        description={t("entityTypes.description")}
      >
        <div className="p-4 sm:p-5">
          <div className="overflow-hidden rounded-lg border">
            <label className={cn(
              "flex items-center gap-3 border-b px-3 py-2.5 text-sm font-medium",
              allCategoriesSelected ? "cursor-default" : "cursor-pointer",
            )}>
              <Checkbox
                checked={allCategoriesSelected}
                disabled={allCategoriesSelected}
                onCheckedChange={(value) => {
                  if (value === true) emit({ entityCategories: null });
                }}
              />
              {t("entityTypes.all")}
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {availableCategories.length || t("entityTypes.none")}
              </span>
            </label>
            {availableCategories.length > 0 ? (
              <div className={cn(
                "grid max-h-48 overflow-y-auto py-1",
                !compact && "sm:grid-cols-2",
              )}>
                {availableCategories.map((category) => {
                  const checked = allCategoriesSelected
                    || Boolean(normalized.entityCategories?.includes(category));
                  const lastSelected = checked && selectedCategoryCount <= 1;
                  return (
                    <label
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 text-sm",
                        lastSelected ? "cursor-default" : "cursor-pointer hover:bg-muted/60",
                      )}
                      key={category}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={lastSelected}
                        onCheckedChange={(value) => toggleCategory(category, value === true)}
                      />
                      <span className="min-w-0 truncate" title={category}>{category}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {t("entityTypes.emptyDescription")}
              </p>
            )}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("window.title")}
        description={t("window.description")}
      >
        <SettingsRow
          title={t("visibleEventBundles.title")}
          description={t("visibleEventBundles.description")}
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                {t("visibleEventBundles.current")}
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {draftWindow.visibleEventBundles}
              </span>
            </div>
            <Slider
              aria-label={t("visibleEventBundles.aria")}
              max={deviceCaps.visible}
              min={UNIVERSE_VIEW_LIMITS.visibleEventBundles.min}
              onValueChange={([value]) => {
                const visibleEventBundles = value ?? effectiveWindow.visibleEventBundles;
                setDraftWindow((current) => ({
                  visibleEventBundles,
                  cachedEventBundles: Math.max(
                    current.cachedEventBundles,
                    minimumUniverseCacheBundles(visibleEventBundles),
                  ),
                }));
              }}
              onValueCommit={([value]) => {
                if (value === undefined) return;
                emit({
                  visibleEventBundles: value,
                });
              }}
              step={UNIVERSE_VIEW_LIMITS.visibleEventBundles.step}
              value={[draftWindow.visibleEventBundles]}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{UNIVERSE_VIEW_LIMITS.visibleEventBundles.min}</span>
              <span>{t("visibleEventBundles.recommended", {
                count: UNIVERSE_VIEW_LIMITS.visibleEventBundles.default,
              })}</span>
              <span>{deviceCaps.visible}</span>
            </div>
          </div>
        </SettingsRow>

        <SettingsRow
          title={t("cachedEventBundles.title")}
          description={t("cachedEventBundles.description")}
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                {t("cachedEventBundles.current")}
              </span>
              <span className="font-mono font-semibold tabular-nums">
                {draftWindow.cachedEventBundles}
              </span>
            </div>
            <Slider
              aria-label={t("cachedEventBundles.aria")}
              max={deviceCaps.cached}
              min={minimumUniverseCacheBundles(draftWindow.visibleEventBundles)}
              onValueChange={([value]) => {
                const cachedEventBundles = value ?? effectiveWindow.cachedEventBundles;
                setDraftWindow((current) => ({
                  visibleEventBundles: current.visibleEventBundles,
                  cachedEventBundles,
                }));
              }}
              onValueCommit={([value]) => {
                if (value === undefined) return;
                emit({
                  cachedEventBundles: value,
                });
              }}
              step={UNIVERSE_VIEW_LIMITS.cachedEventBundles.step}
              value={[draftWindow.cachedEventBundles]}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{minimumUniverseCacheBundles(draftWindow.visibleEventBundles)}</span>
              <span>{t("cachedEventBundles.runway", {
                count: Math.max(
                  0,
                  draftWindow.cachedEventBundles - draftWindow.visibleEventBundles,
                ),
              })}</span>
              <span>{deviceCaps.cached}</span>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <div className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 shadow-soft",
        !compact && "sm:flex-row sm:items-center sm:justify-between sm:px-5",
      )}>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("reset.savedLocally")}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          <RotateCcw />
          {t("reset.action")}
        </Button>
      </div>
    </div>
  );
}
