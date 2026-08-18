"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useApp } from "@/components/features/app-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiError } from "@/lib/api";
import {
  MODEL_PRESETS,
  activePresetId,
  presetToPatch,
  type ModelPreset,
} from "@/lib/model-presets";
import type { ModelConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 问答页顶部模型快捷切换：显示当前生成模型，下拉一键切换预设（免重启）。
 */
export function ModelPresetMenu({ className }: { className?: string }) {
  const t = useTranslations("ModelConfig");
  const { refreshCapabilities } = useApp();
  const [cfg, setCfg] = React.useState<ModelConfig | null>(null);
  const [switching, setSwitching] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .getModelConfig()
      .then((config) => {
        if (!cancelled) setCfg(config);
      })
      .catch(() => {
        // 配置不可用时保持未加载状态（下拉仅显示原始模型名）
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeId = cfg ? activePresetId(cfg) : undefined;

  async function applyPreset(preset: ModelPreset) {
    setSwitching(preset.id);
    try {
      const { config } = await api.saveModelConfig(presetToPatch(preset));
      setCfg(config);
      await refreshCapabilities();
      toast.success(t("presetSwitched", { model: config.llm_model }));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("presetSwitchFailed"));
    } finally {
      setSwitching(null);
    }
  }

  const label = activeId
    ? t(
        MODEL_PRESETS.find((preset) => preset.id === activeId)!.labelKey,
      )
    : (cfg?.llm_model ?? t("presetUnknown"));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 px-2.5 text-xs", className)}
          disabled={switching !== null}
        >
          {switching !== null ? (
            <Spinner className="size-3.5" />
          ) : (
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          )}
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t("presetTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODEL_PRESETS.map((preset) => {
          const active = activeId === preset.id;
          return (
            <DropdownMenuItem
              key={preset.id}
              disabled={switching !== null || active}
              onSelect={() => void applyPreset(preset)}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-medium">{t(preset.labelKey)}</span>
                {active && <Check className="size-4 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground">{t(preset.descriptionKey)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
