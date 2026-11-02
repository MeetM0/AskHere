// Builds the system prompt and the first user turn from what the user highlighted.

export function buildSystemPrompt(settings) {
  const length =
    settings.answerLength === 'detailed'
      ? 'Be thorough, but organise the answer so it is easy to scan.'
      : 'Keep it short: usually 2-6 sentences, unless the question genuinely needs more.';

  let prompt = `You are AskHere, a reading assistant shown in a small popup right next to text the user highlighted on a web page. The user wants a quick side answer without losing their place on the page.

Answer the user's question about the highlighted passage directly. ${length} Use Markdown sparingly: short paragraphs, simple bullet lists, and \`inline code\` or fenced code blocks for code. Do not repeat the highlighted passage back. If the passage is ambiguous without more context, briefly say what you are assuming.`;

  const custom = (settings.customInstructions || '').trim();
  if (custom) prompt += `\n\nThe user's own instructions:\n${custom}`;
  return prompt;
}

/**
 * @param {{selection:string, context?:string, title?:string, url?:string}} source
 * @param {string} question
 */
export function buildFirstTurn(source, question) {
  const parts = [];
  parts.push(`<page title="${attr(source.title)}" url="${attr(source.url)}">`);
  parts.push(`<highlighted>\n${source.selection}\n</highlighted>`);
  if (source.context && source.context.trim() && source.context.trim() !== source.selection.trim()) {
    parts.push(`<surrounding_text>\n${source.context}\n</surrounding_text>`);
  }
  parts.push('</page>');
  parts.push('');
  parts.push(`Question: ${question}`);
  return parts.join('\n');
}

function attr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .slice(0, 300);
}
