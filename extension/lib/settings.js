// Shared settings defaults (chrome.storage.local).

export const DEFAULTS = {
  // Which AI to open. 'auto' = the one whose site you're on (reading on
  // chatgpt.com -> ChatGPT, on claude.ai -> Claude), otherwise `defaultAI`.
  target: 'auto', // 'auto' | 'claude' | 'chatgpt'
  defaultAI: 'claude', // 'claude' | 'chatgpt'
  // Where the AI opens: 'auto' = small window, except in fullscreen on a Mac
  // (a window would jump to another desktop Space) where the floating
  // picture-in-picture window is used.
  openIn: 'auto', // 'auto' | 'window' | 'pip' | 'sidepanel'
  windowSize: 'small', // 'small' | 'medium' | 'large'
  compactWindow: true, // hide the AI site's sidebar/header and brand the window as AskHere
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
  small: { width: 380, height: 520 },
  medium: { width: 440, height: 620 },
  large: { width: 560, height: 760 },
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
