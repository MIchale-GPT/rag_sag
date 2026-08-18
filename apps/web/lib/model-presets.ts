import type { ModelConfig, ModelConfigPatch, ModelProviderId } from "@/lib/types";

/**
 * 预设生成模型（一键切换）。
 * 本地单用户部署：qwen3.6-27b 走 WSL 内代理 43023（api_key 用占位）；
 * deepseek-v4-flash 走官方 API。切换经 PUT /system/model-config 立即生效（免重启）。
 */
export interface ModelPreset {
  id: "qwen-local" | "deepseek-commercial";
  labelKey: "presetQwenName" | "presetDeepseekName";
  descriptionKey: "presetQwenDesc" | "presetDeepseekDesc";
  badge: "local" | "commercial";
  patch: {
    llm_provider: ModelProviderId;
    llm_base_url: string;
    llm_api_key: string;
    llm_model: string;
    llm_temperature: number;
    llm_max_tokens: number;
    llm_timeout_ms: number;
    llm_max_retries: number;
    llm_context_window: number;
  };
}

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "qwen-local",
    labelKey: "presetQwenName",
    descriptionKey: "presetQwenDesc",
    badge: "local",
    patch: {
      llm_provider: "openai",
      llm_base_url: "http://127.0.0.1:43023/v1",
      llm_api_key: "local-proxy",
      llm_model: "qwen3.6-27b",
      llm_temperature: 0.3,
      llm_max_tokens: 20_000,
      llm_timeout_ms: 600_000,
      llm_max_retries: 2,
      llm_context_window: 65_536,
    },
  },
  {
    id: "deepseek-commercial",
    labelKey: "presetDeepseekName",
    descriptionKey: "presetDeepseekDesc",
    badge: "commercial",
    patch: {
      llm_provider: "openai",
      llm_base_url: "https://api.deepseek.com/v1",
      llm_api_key: "sk-c6e39a1bae4441ea936435ff9f30129b",
      llm_model: "deepseek-v4-flash",
      llm_temperature: 0.3,
      llm_max_tokens: 20_000,
      llm_timeout_ms: 600_000,
      llm_max_retries: 2,
      llm_context_window: 128_000,
    },
  },
];

export function isModelPresetActive(cfg: ModelConfig, preset: ModelPreset): boolean {
  return (
    preset.patch.llm_model === cfg.llm_model &&
    (preset.patch.llm_base_url ?? "") === (cfg.llm_base_url ?? "")
  );
}

export function activePresetId(cfg: ModelConfig): ModelPreset["id"] | undefined {
  return MODEL_PRESETS.find((preset) => isModelPresetActive(cfg, preset))?.id;
}

export function presetToPatch(preset: ModelPreset): ModelConfigPatch {
  return { ...preset.patch };
}
