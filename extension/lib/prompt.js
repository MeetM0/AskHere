// Builds the message that gets typed into Claude / ChatGPT.

const MAX_SELECTION = 6000;

/**
 * @param {{selection:string, question:string, title?:string, url?:string}} q
 * @param {{prefix?:string}} settings
 */
export function buildPrompt(q, settings = {}) {
  let selection = String(q.selection || '').trim();
  if (selection.length > MAX_SELECTION) selection = selection.slice(0, MAX_SELECTION) + ' …';
  const question = String(q.question || '').trim() || 'Explain this.';

  const where = q.title ? ` from "${oneLine(q.title)}"` : '';
  const lines = [];
  lines.push(`About this text${where}${q.url ? ` (${q.url})` : ''}:`);
  lines.push('');
  lines.push(quote(selection));
  lines.push('');
  lines.push(question);
  const prefix = String(settings.prefix || '').trim();
  if (prefix) {
    lines.push('');
    lines.push(prefix);
  }
  return lines.join('\n');
}

function quote(text) {
  return text
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n');
}

function oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 120);
}
