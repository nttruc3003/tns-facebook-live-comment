// Presets are conveniences, not a claim that every account can access every model.
// Claude IDs: https://platform.claude.com/docs/en/models/overview
export const aiModelOptions: Record<string, { id: string; label: string }[]> = {
  openai: [
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  ],
  gemini: [{ id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }],
  compatible: [],
};
