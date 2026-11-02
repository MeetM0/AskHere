// Shared settings defaults. Stored in chrome.storage.local (never synced),
// so API keys stay on this device only.

export const DEFAULTS = {
  provider: 'anthropic', // 'anthropic' | 'openai'
  anthropicKey: '',
  anthropicModel: 'claude-opus-5-5',
  openaiKey: '',
  openaiModel: 'gpt-5',
  effort: 'low', // Claude only: 'low' | 'medium' | 'high' — lower is faster & cheaper
  answerLength: 'concise', // 'concise' | 'detailed'
  customInstructions: '',
  triggerMode: 'button', // 'button' | 'alt' | 'off'
  disabledSites: '', // newline-separated hostnames
};

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (smartest)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

export async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}
