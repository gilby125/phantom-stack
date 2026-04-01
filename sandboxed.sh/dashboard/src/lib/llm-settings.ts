/**
 * LLM provider configuration for dashboard UX features (e.g. auto-generated
 * mission titles). Stored in localStorage, separate from backend settings.
 */

export interface LLMProviderPreset {
  name: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
}

export const LLM_PROVIDERS: Record<string, LLMProviderPreset> = {
  cerebras: {
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "gpt-oss-120b-cs",
    models: ["gpt-oss-120b-cs", "zai-glm-4.6-cs"],
  },
  zai: {
    name: "Z.AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.7",
    models: ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.6v-flash"],
  },
  groq: {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
  },
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini"],
  },
  gemini: {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  },
};

export type LLMProviderKind = "preset" | "custom";
export type LLMProviderId = string;

export interface LLMProviderConfig {
  id: LLMProviderId;
  name: string;
  kind: LLMProviderKind;
  preset?: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  autoTitle: boolean;
}

export interface LLMSettings {
  activeProviderId: LLMProviderId;
  providers: LLMProviderConfig[];
}

/**
 * Legacy compatibility type. Existing callers historically operated on a
 * single LLM config object. We now map that to the active provider entry.
 */
export type LLMConfig = LLMProviderConfig;

const STORAGE_KEY = "llm-config";
const DEFAULT_PROVIDER_ID = "cerebras";

function defaultProviderFromPreset(presetId: string, id = presetId): LLMProviderConfig {
  const preset = LLM_PROVIDERS[presetId] || LLM_PROVIDERS.cerebras;
  return {
    id,
    name: preset.name,
    kind: "preset",
    preset: presetId in LLM_PROVIDERS ? presetId : "cerebras",
    enabled: false,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.defaultModel,
    autoTitle: true,
  };
}

function defaultCustomProvider(id = "custom-provider"): LLMProviderConfig {
  return {
    id,
    name: "Custom Provider",
    kind: "custom",
    enabled: false,
    baseUrl: "",
    apiKey: "",
    model: "",
    autoTitle: true,
  };
}

function createDefaultSettings(): LLMSettings {
  return {
    activeProviderId: DEFAULT_PROVIDER_ID,
    providers: [defaultProviderFromPreset(DEFAULT_PROVIDER_ID)],
  };
}

function uniqueProviderId(base: string, existing: Set<string>): string {
  const slug = base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "provider";
  if (!existing.has(slug)) return slug;

  let idx = 2;
  while (existing.has(`${slug}-${idx}`)) idx += 1;
  return `${slug}-${idx}`;
}

function normalizeProviderId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeProviderName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeProviderKind(value: unknown): LLMProviderKind {
  return value === "custom" ? "custom" : "preset";
}

function normalizeProviderConfig(value: unknown, index: number, existingIds: Set<string>): LLMProviderConfig {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const kind = normalizeProviderKind(raw.kind);
  const preset = typeof raw.preset === "string" && raw.preset in LLM_PROVIDERS ? raw.preset : undefined;
  const fallbackId = kind === "preset" && preset ? preset : `provider-${index + 1}`;
  const id = uniqueProviderId(normalizeProviderId(raw.id, fallbackId), existingIds);
  existingIds.add(id);

  if (kind === "preset") {
    const presetId = preset || (typeof raw.provider === "string" && raw.provider in LLM_PROVIDERS
      ? raw.provider
      : DEFAULT_PROVIDER_ID);
    const presetInfo = LLM_PROVIDERS[presetId] || LLM_PROVIDERS[DEFAULT_PROVIDER_ID];
    return {
      id,
      name: normalizeProviderName(raw.name, presetInfo.name),
      kind: "preset",
      preset: presetId,
      enabled: Boolean(raw.enabled ?? false),
      baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : presetInfo.baseUrl,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : presetInfo.defaultModel,
      autoTitle: raw.autoTitle !== false,
    };
  }

  return {
    id,
    name: normalizeProviderName(raw.name, "Custom Provider"),
    kind: "custom",
    enabled: Boolean(raw.enabled ?? false),
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl.trim() : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    autoTitle: raw.autoTitle !== false,
  };
}

function migrateLegacySettings(raw: unknown): LLMSettings {
  const legacy = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const provider = typeof legacy.provider === "string" ? legacy.provider : DEFAULT_PROVIDER_ID;
  const customProviderId = typeof legacy.customProviderId === "string" ? legacy.customProviderId.trim() : "";
  const customProviderName = typeof legacy.customProviderName === "string" ? legacy.customProviderName.trim() : "";
  const preset = provider in LLM_PROVIDERS ? provider : undefined;
  const legacyCustomId = customProviderId
    || (provider.trim() && provider !== "custom" ? provider.trim() : "custom-provider");
  const fallbackId = preset ?? legacyCustomId;
  const id = uniqueProviderId(fallbackId || DEFAULT_PROVIDER_ID, new Set<string>());
  const kind: LLMProviderKind = preset ? "preset" : "custom";
  const presetInfo = preset ? LLM_PROVIDERS[preset] : undefined;
  const providerConfig: LLMProviderConfig = {
    id,
    name: kind === "custom"
      ? (customProviderName || "Custom Provider")
      : (presetInfo?.name || provider),
    kind,
    preset,
    enabled: Boolean(legacy.enabled ?? false),
    baseUrl: typeof legacy.baseUrl === "string"
      ? legacy.baseUrl.trim()
      : (presetInfo?.baseUrl || ""),
    apiKey: typeof legacy.apiKey === "string" ? legacy.apiKey : "",
    model: typeof legacy.model === "string"
      ? legacy.model.trim()
      : (presetInfo?.defaultModel || ""),
    autoTitle: legacy.autoTitle !== false,
  };

  return {
    activeProviderId: providerConfig.id,
    providers: [providerConfig],
  };
}

function normalizeSettings(raw: unknown): LLMSettings {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.providers)) {
      const existingIds = new Set<string>();
      const providers = record.providers.map((provider, index) =>
        normalizeProviderConfig(provider, index, existingIds)
      );
      const activeProviderId =
        typeof record.activeProviderId === "string" && providers.some((p) => p.id === record.activeProviderId)
          ? record.activeProviderId
          : providers[0]?.id || DEFAULT_PROVIDER_ID;
      return {
        activeProviderId,
        providers: providers.length > 0 ? providers : [defaultProviderFromPreset(DEFAULT_PROVIDER_ID)],
      };
    }
  }
  return migrateLegacySettings(raw);
}

export function createProviderFromPreset(presetId: string, existingIds: Set<string> = new Set()): LLMProviderConfig {
  const preset = LLM_PROVIDERS[presetId] || LLM_PROVIDERS[DEFAULT_PROVIDER_ID];
  const id = uniqueProviderId(presetId in LLM_PROVIDERS ? presetId : DEFAULT_PROVIDER_ID, existingIds);
  existingIds.add(id);
  return {
    id,
    name: preset.name,
    kind: "preset",
    preset: presetId in LLM_PROVIDERS ? presetId : DEFAULT_PROVIDER_ID,
    enabled: false,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.defaultModel,
    autoTitle: true,
  };
}

export function createCustomProvider(existingIds: Set<string> = new Set(), index = 1): LLMProviderConfig {
  const id = uniqueProviderId(`custom-provider-${index}`, existingIds);
  existingIds.add(id);
  return defaultCustomProvider(id);
}

export async function fetchLiveCerebrasModels(): Promise<string[]> {
  const fallback = [...(LLM_PROVIDERS.cerebras?.models ?? [])];
  try {
    const response = await fetch("https://api.cerebras.ai/v1/models");
    if (!response.ok) return fallback;

    const payload = await response.json() as { data?: Array<{ id?: unknown }> };
    const models = (payload.data ?? [])
      .map((model) => (typeof model.id === "string" ? model.id.trim() : ""))
      .filter(Boolean);

    return models.length > 0 ? models : fallback;
  } catch {
    return fallback;
  }
}

export function readLLMSettings(): LLMSettings {
  if (typeof window === "undefined") return createDefaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return createDefaultSettings();
  }
}

export function writeLLMSettings(settings: LLMSettings): void {
  if (typeof window === "undefined") return;
  const existingIds = new Set<string>();
  const providers = settings.providers.map((provider, index) =>
    normalizeProviderConfig(provider, index, existingIds)
  );
  const activeProviderId =
    providers.some((provider) => provider.id === settings.activeProviderId)
      ? settings.activeProviderId
      : providers[0]?.id || DEFAULT_PROVIDER_ID;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ activeProviderId, providers })
  );
}

export function getActiveLLMProvider(settings?: LLMSettings): LLMProviderConfig | null {
  const current = settings ?? readLLMSettings();
  return current.providers.find((provider) => provider.id === current.activeProviderId)
    ?? current.providers.find((provider) => provider.enabled)
    ?? current.providers[0]
    ?? null;
}

export function readLLMConfig(): LLMConfig {
  return getActiveLLMProvider() ?? createDefaultSettings().providers[0];
}

export function writeLLMConfig(config: LLMConfig): void {
  const settings = readLLMSettings();
  const existingIds = new Set(settings.providers.map((provider) => provider.id));
  const normalized = normalizeProviderConfig(config, settings.providers.length, existingIds);
  const providers = settings.providers.map((provider) =>
    provider.id === normalized.id ? normalized : provider
  );
  const existingIndex = settings.providers.findIndex((provider) => provider.id === normalized.id);
  if (existingIndex === -1) {
    providers.push(normalized);
  }
  writeLLMSettings({
    activeProviderId: normalized.id,
    providers,
  });
}

/** Quick check: is LLM-powered title generation usable? */
export function isAutoTitleEnabled(): boolean {
  const cfg = getActiveLLMProvider();
  return Boolean(cfg?.enabled && cfg.autoTitle && cfg.apiKey.length > 0);
}
