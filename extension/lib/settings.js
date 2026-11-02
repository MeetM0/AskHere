// Shared settings defaults (chrome.storage.local).

export const DEFAULTS = {
  // Which AI to open. 'auto' = the one whose site you're on (reading on
  // chatgpt.com -> ChatGPT, on claude.ai -> Claude), otherwise `defaultAI`.
  target: 'auto', // 'auto' | 'claude' | 'chatgpt'
  defaultAI: 'claude', // 'claude' | 'chatgpt'
  windowSize: 'medium', // 'small' | 'medium' | 'large'
  reuseWindow: true, // move & reuse one AskHere window instead of opening many
  autoSend: true, // press send for you
  prefix: '', // text added to every question, e.g. "Answer briefly."
  triggerMode: 'button', // 'button' | 'alt' | 'off'
  disabledSites: '', // newline-separated hostnames
};

export const AI_SITES = {
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
};

export const WINDOW_SIZES = {
  small: { width: 420, height: 600 },
  medium: { width: 520, height: 720 },
  large: { width: 680, height: 860 },
};

export async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

/** Pick which AI to open for a question asked on `hostname`. */
export function resolveTarget(settings, hostname = '') {
  if (settings.target === 'claude' || settings.target === 'chatgpt') return settings.target;
  const host = hostname.replace(/^www\./, '');
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'claude';
  if (host === 'chatgpt.com' || host.endsWith('.chatgpt.com') || host === 'chat.openai.com') return 'chatgpt';
  return settings.defaultAI === 'chatgpt' ? 'chatgpt' : 'claude';
}
