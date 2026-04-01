'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Loader, Plus, Sparkles, Zap } from 'lucide-react';
import { toast } from '@/components/toast';
import { cn } from '@/lib/utils';
import { generateMissionTitle, testLLMConnection } from '@/lib/llm';
import {
  createCustomProvider,
  createProviderFromPreset,
  fetchLiveCerebrasModels,
  getActiveLLMProvider,
  LLM_PROVIDERS,
  readLLMSettings,
  type LLMProviderConfig,
  type LLMSettings,
  writeLLMSettings,
} from '@/lib/llm-settings';

const PRESET_ORDER = ['cerebras', 'gemini', 'openai', 'groq', 'zai'];

function providerTitle(provider: LLMProviderConfig): string {
  return provider.name.trim() || (provider.kind === 'preset'
    ? LLM_PROVIDERS[provider.preset ?? '']?.name || 'Provider'
    : 'Custom Provider');
}

function providerKindLabel(provider: LLMProviderConfig): string {
  return provider.kind === 'preset'
    ? LLM_PROVIDERS[provider.preset ?? '']?.name || 'Preset'
    : 'Custom';
}

function providerIdLabel(provider: LLMProviderConfig): string {
  return provider.id.trim() || providerTitle(provider).toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function makeUniqueId(base: string, existing: Set<string>): string {
  const slug = base
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'provider';
  if (!existing.has(slug)) return slug;

  let index = 2;
  while (existing.has(`${slug}-${index}`)) index += 1;
  return `${slug}-${index}`;
}

export default function LLMSettingsPage() {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>(
    () => Object.fromEntries(Object.entries(LLM_PROVIDERS).map(([id, provider]) => [id, provider.models]))
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [newProviderKind, setNewProviderKind] = useState<'custom' | string>('custom');
  const [newCustomId, setNewCustomId] = useState('');
  const [newCustomName, setNewCustomName] = useState('');

  useEffect(() => {
    setSettings(readLLMSettings());
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadLiveCerebrasModels = async () => {
      try {
        const models = await fetchLiveCerebrasModels();
        if (!cancelled) {
          setProviderModels((prev) => ({ ...prev, cerebras: models }));
        }
      } catch {
        // Keep static fallback list when live fetch fails.
      }
    };

    void loadLiveCerebrasModels();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProvider = useMemo(() => getActiveLLMProvider(settings ?? undefined), [settings]);
  const activeProviderPreset = activeProvider?.kind === 'preset'
    ? LLM_PROVIDERS[activeProvider.preset ?? '']
    : null;
  const activeProviderModels = activeProvider?.kind === 'preset'
    ? providerModels[activeProvider.preset ?? ''] ?? activeProviderPreset?.models ?? []
    : [];

  useEffect(() => {
    if (!settings) return;
    const nextProviders = settings.providers.map((provider) => {
      if (provider.kind !== 'preset') return provider;
      const presetId = provider.preset && providerModels[provider.preset] ? provider.preset : provider.preset || 'cerebras';
      const options = providerModels[presetId] ?? LLM_PROVIDERS[presetId]?.models ?? [];
      if (options.length === 0 || options.includes(provider.model)) return provider;
      return { ...provider, model: options[0] };
    });

    const changed = nextProviders.some((provider, index) => provider !== settings.providers[index]);
    if (changed) {
      const next = { ...settings, providers: nextProviders };
      setSettings(next);
      writeLLMSettings(next);
    }
  }, [providerModels, settings]);

  const persist = (next: LLMSettings) => {
    setSettings(next);
    writeLLMSettings(next);
  };

  const updateProvider = (id: string, patch: Partial<LLMProviderConfig>) => {
    if (!settings) return;
    const next = {
      ...settings,
      providers: settings.providers.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider
      ),
    };
    persist(next);
  };

  const setActiveProvider = (id: string) => {
    if (!settings) return;
    persist({ ...settings, activeProviderId: id });
    setShowApiKey(false);
  };

  const addProvider = () => {
    if (!settings) return;
    const nextProviders = [...settings.providers];
    if (newProviderKind === 'custom') {
      const existingIds = new Set(nextProviders.map((provider) => provider.id));
      const baseId = newCustomId.trim() || newCustomName.trim() || `custom-provider-${nextProviders.length + 1}`;
      const provider = createCustomProvider(existingIds, nextProviders.length + 1);
      provider.id = makeUniqueId(baseId, existingIds);
      provider.name = newCustomName.trim() || 'Custom Provider';
      nextProviders.push(provider);
      const next = { ...settings, activeProviderId: provider.id, providers: nextProviders };
      persist(next);
      setNewCustomId('');
      setNewCustomName('');
      return;
    }

    const presetId = newProviderKind in LLM_PROVIDERS ? newProviderKind : 'cerebras';
    const existingIds = new Set(nextProviders.map((provider) => provider.id));
    const provider = createProviderFromPreset(presetId, existingIds);
    nextProviders.push(provider);
    persist({ ...settings, activeProviderId: provider.id, providers: nextProviders });
  };

  const duplicateProvider = (id: string) => {
    if (!settings) return;
    const source = settings.providers.find((provider) => provider.id === id);
    if (!source) return;
    const existingIds = new Set(settings.providers.map((provider) => provider.id));
    const clone: LLMProviderConfig = {
      ...source,
      id: `${source.id}-copy`,
      name: `${source.name} Copy`,
    };
    let uniqueId = clone.id;
    let index = 2;
    while (existingIds.has(uniqueId)) {
      uniqueId = `${clone.id}-${index}`;
      index += 1;
    }
    clone.id = uniqueId;
    const next = {
      ...settings,
      providers: [...settings.providers, clone],
      activeProviderId: clone.id,
    };
    persist(next);
  };

  const removeProvider = (id: string) => {
    if (!settings || settings.providers.length <= 1) {
      toast.error('Keep at least one provider configured');
      return;
    }
    const providers = settings.providers.filter((provider) => provider.id !== id);
    const activeProviderId = settings.activeProviderId === id ? providers[0].id : settings.activeProviderId;
    persist({ ...settings, providers, activeProviderId });
  };

  const handleTest = async () => {
    if (!activeProvider) return;
    setTesting(true);
    setTestResult(null);

    try {
      const probe = await testLLMConnection(activeProvider);
      if (!probe.ok) {
        toast.error(`Connection failed: ${probe.error ?? 'Unknown error'}`);
        return;
      }

      const title = await generateMissionTitle(
        'Fix the authentication bug in the login page',
        "I'll investigate the login flow and fix the session handling issue.",
        activeProvider,
      );
      const sample = title || probe.content || 'OK';
      if (sample) {
        setTestResult(sample);
        toast.success('LLM connection working');
      } else {
        toast.error('No response from LLM - check your API key and base URL');
      }
    } catch (err) {
      toast.error(`LLM request failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setTesting(false);
    }
  };

  const activeProviderLabel = activeProvider ? providerTitle(activeProvider) : 'No provider selected';
  const activeProviderTypeLabel = activeProvider ? providerKindLabel(activeProvider) : 'Provider';

  if (!settings || !activeProvider) return null;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-white">LLM</h1>
          <p className="max-w-2xl text-sm text-white/50">
            Configure one or more dashboard LLM providers for auto-generated mission titles and other UX features.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                  <Plus className="h-4 w-4 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-sm font-medium text-white">Add provider</h2>
                  <p className="text-xs text-white/40">Create a preset or custom provider</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60">Template</label>
                  <select
                    value={newProviderKind}
                    onChange={(e) => setNewProviderKind(e.target.value)}
                    className="w-full appearance-none rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-indigo-500/40 focus:outline-none"
                  >
                    <option value="custom" className="bg-[#1a1a1a]">Custom provider</option>
                    {PRESET_ORDER.filter((id) => LLM_PROVIDERS[id]).map((id) => (
                      <option key={id} value={id} className="bg-[#1a1a1a]">
                        {LLM_PROVIDERS[id].name}
                      </option>
                    ))}
                  </select>
                </div>

                {newProviderKind === 'custom' ? (
                  <div className="grid gap-3">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-white/60">Provider ID</label>
                      <input
                        value={newCustomId}
                        onChange={(e) => setNewCustomId(e.target.value)}
                        placeholder="my-provider"
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-white/60">Provider Name</label>
                      <input
                        value={newCustomName}
                        onChange={(e) => setNewCustomName(e.target.value)}
                        placeholder="My Provider"
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-white/60">Name</label>
                    <input
                      value={LLM_PROVIDERS[newProviderKind]?.name || ''}
                      onChange={(e) => {
                        void e;
                      }}
                      disabled
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm text-white/60"
                    />
                  </div>
                )}

                <button
                  onClick={addProvider}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500/20 px-4 py-2.5 text-sm font-medium text-indigo-300 transition-colors hover:bg-indigo-500/30"
                >
                  <Plus className="h-4 w-4" />
                  Add provider
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {settings.providers.map((provider) => {
                const isActive = provider.id === settings.activeProviderId;
                const title = providerTitle(provider);
                const presetLabel = provider.kind === 'preset'
                  ? LLM_PROVIDERS[provider.preset ?? '']?.name || 'Preset'
                  : 'Custom';
                return (
                  <button
                    key={provider.id}
                    onClick={() => setActiveProvider(provider.id)}
                    className={cn(
                      'w-full rounded-2xl border p-4 text-left transition-all',
                      isActive
                        ? 'border-indigo-500/40 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.18)]'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-medium text-white">{title}</h3>
                          {provider.id === settings.activeProviderId && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                              Active
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-white/35">
                          {provider.id}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-white/50">
                        {presetLabel}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-white/45">
                      <div className="truncate">
                        {provider.baseUrl || 'No base URL set'}
                      </div>
                      <div className="truncate">
                        {provider.model || 'No model set'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-4">
            <div className="rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10">
                    <Zap className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{activeProviderLabel}</h2>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                        {activeProviderTypeLabel}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-white/45">
                      This is the provider the dashboard will use for mission title generation.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleTest}
                    disabled={!activeProvider.apiKey || testing}
                    className={cn(
                      'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors',
                      activeProvider.apiKey && !testing
                        ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                        : 'cursor-not-allowed bg-white/[0.04] text-white/30'
                    )}
                  >
                    {testing ? <Loader className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Test connection
                  </button>
                  <button
                    onClick={() => duplicateProvider(activeProvider.id)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-white/[0.06]"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => removeProvider(activeProvider.id)}
                    disabled={settings.providers.length <= 1}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm font-medium text-white/75 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {testResult && (
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  Generated title: “{testResult}”
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                    <Sparkles className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">Provider settings</h3>
                    <p className="text-xs text-white/40">Core identity and connection fields</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-white/60">Provider ID</label>
                      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-white/60">
                        {providerIdLabel(activeProvider)}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-white/60">Provider type</label>
                      <select
                        value={activeProvider.kind === 'preset' ? activeProvider.preset : 'custom'}
                        onChange={(e) => {
                          if (activeProvider.kind !== 'preset') return;
                          const presetId = e.target.value;
                          const preset = LLM_PROVIDERS[presetId] || LLM_PROVIDERS.cerebras;
                          updateProvider(activeProvider.id, {
                            kind: 'preset',
                            preset: presetId,
                            name: preset.name,
                            baseUrl: preset.baseUrl,
                            model: preset.defaultModel,
                          });
                        }}
                        disabled={activeProvider.kind === 'custom'}
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-indigo-500/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {activeProvider.kind === 'preset'
                          ? PRESET_ORDER.filter((id) => LLM_PROVIDERS[id]).map((id) => (
                              <option key={id} value={id} className="bg-[#1a1a1a]">
                                {LLM_PROVIDERS[id].name}
                              </option>
                            ))
                          : <option value="custom" className="bg-[#1a1a1a]">Custom</option>}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-white/60">Display name</label>
                    <input
                      value={activeProvider.name}
                      onChange={(e) => updateProvider(activeProvider.id, { name: e.target.value })}
                      placeholder="Custom Provider"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-white/60">Base URL</label>
                    <input
                      value={activeProvider.baseUrl}
                      onChange={(e) => updateProvider(activeProvider.id, { baseUrl: e.target.value })}
                      placeholder="https://api.cerebras.ai/v1"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-white/60">API key</label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={activeProvider.apiKey}
                        onChange={(e) => updateProvider(activeProvider.id, { apiKey: e.target.value })}
                        placeholder="sk-..."
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 pr-10 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                      />
                      <button
                        onClick={() => setShowApiKey((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/60"
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-white/60">Model</label>
                    {activeProvider.kind === 'preset' && activeProviderModels.length > 0 ? (
                      <select
                        value={activeProvider.model}
                        onChange={(e) => updateProvider(activeProvider.id, { model: e.target.value })}
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white focus:border-indigo-500/40 focus:outline-none"
                      >
                        {activeProviderModels.map((model) => (
                          <option key={model} value={model} className="bg-[#1a1a1a]">
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={activeProvider.model}
                        onChange={(e) => updateProvider(activeProvider.id, { model: e.target.value })}
                        placeholder="model-name"
                        className="w-full rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/20 focus:border-indigo-500/40 focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
                    <Zap className="h-5 w-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-white">Behavior</h3>
                    <p className="text-xs text-white/40">Enablement and dashboard title generation</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-sm text-white/80">Enabled</p>
                      <p className="text-xs text-white/40">This provider can be selected by the dashboard</p>
                    </div>
                    <button
                      onClick={() => updateProvider(activeProvider.id, { enabled: !activeProvider.enabled })}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        activeProvider.enabled ? 'bg-emerald-500' : 'bg-white/10'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                          activeProvider.enabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                    <div>
                      <p className="text-sm text-white/80">Auto-generate mission titles</p>
                      <p className="text-xs text-white/40">Use this provider for dashboard title generation</p>
                    </div>
                    <button
                      onClick={() => updateProvider(activeProvider.id, { autoTitle: !activeProvider.autoTitle })}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        activeProvider.autoTitle ? 'bg-emerald-500' : 'bg-white/10'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                          activeProvider.autoTitle ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>

                  <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-white/30">Selected provider</p>
                        <p className="mt-1 text-sm text-white/80">{activeProviderLabel}</p>
                      </div>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[10px] font-medium text-white/50">
                        {providerKindLabel(activeProvider)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-2 text-xs text-white/45">
                      <div className="truncate">{activeProvider.baseUrl || 'No base URL set'}</div>
                      <div className="truncate">{activeProvider.model || 'No model set'}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                    <p className="text-sm text-emerald-200">Test result</p>
                    <p className="mt-1 text-xs text-emerald-200/70">
                      {testResult ? `Generated title: ${testResult}` : 'Run a connection test to verify this provider.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
