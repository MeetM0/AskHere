# Contributing to AskHere

Thanks for helping! AskHere is plain JavaScript with **no build step**, so getting started is quick.

## Setup

1. Fork and clone the repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
3. After changing code, click the ↻ reload icon on the AskHere card and refresh the page you're testing on.

## Project layout

| Path | What it does |
| --- | --- |
| `extension/content.js` | Runs on every page: the **Ask AI** button and the small question box next to the text |
| `extension/panel.css` | Styles for that UI (inside a shadow root so sites can't break them) |
| `extension/background.js` | Service worker: opens or moves the Claude/ChatGPT popup window next to the text and remembers the question for it |
| `extension/inject.js` | Runs on claude.ai / chatgpt.com: types the question into the chat box and presses send |
| `extension/lib/placement.js` | Works out where on screen the window goes |
| `extension/lib/prompt.js` | Builds the message that gets sent |
| `extension/options.*` | Settings page |

**If Claude or ChatGPT change their page and auto-send stops working**, the selectors at the top of `extension/inject.js` are what need updating.

## Tests

```bash
npm test            # unit tests (Node 20+)
npm run test:e2e    # loads the real extension in Chromium against a fake claude.ai page (needs Playwright)
```

## Guidelines

- Keep it build-free and dependency-free inside `extension/`.
- No API keys and no calls to private AI APIs. AskHere only opens the normal websites and types into them like a person would.
- Add a test for bug fixes where you can.
