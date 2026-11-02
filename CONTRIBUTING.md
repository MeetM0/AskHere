# Contributing to AskHere

Thanks for helping! AskHere is plain JavaScript with **no build step**, so getting started is quick.

## Setup

1. Fork and clone the repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
3. After changing code, click the ↻ reload icon on the AskHere card and refresh the page you're testing on.

## Project layout

| Path | What it does |
| --- | --- |
| `extension/content.js` | Runs on every page: the **Ask AI** button, the floating panel, keeping it next to the text |
| `extension/panel.css` | Panel styles (inside a shadow root so sites can't break them) |
| `extension/background.js` | Service worker: holds API keys, makes the API calls, streams text back to the panel |
| `extension/lib/providers.js` | Claude and OpenAI streaming calls |
| `extension/lib/prompt.js` | System prompt and how the highlighted text is sent to the model |
| `extension/lib/markdown.js` | Small, safe Markdown renderer for answers |
| `extension/options.*` | Settings page |

## Tests

```bash
npm test            # unit tests (Node 20+)
npm run test:e2e    # loads the real extension in Chromium with a mocked API (needs Playwright)
```

## Guidelines

- Keep it build-free and dependency-free inside `extension/`.
- API keys must never reach content scripts or web pages. Only `background.js` reads them.
- Never inject raw model output as HTML. Go through `lib/markdown.js`.
- Add a test for bug fixes where you can.
