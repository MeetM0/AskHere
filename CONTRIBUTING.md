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
| `extension/inject.js` | Runs on claude.ai / chatgpt.com: types the question, presses send, and (floating mode) reads the answer as it streams |
| `extension/sidepanel.*` | Side panel used in Mac fullscreen: shows claude.ai / chatgpt.com in a frame and hands the question to it |
| `extension/pip-ui.js` | The floating picture-in-picture window (used in Mac fullscreen) |
| `extension/lib/sanitize.js` | Turns an AI answer into safe plain data and back (no HTML strings) |
| `extension/lib/mode.js` | Decides small window vs floating window vs side panel (Mac + fullscreen → floating) |
| `extension/lib/placement.js` | Works out where on screen the window goes |
| `extension/lib/windows.js` | Opens/reuses the window and keeps it small and normal (also when Chrome is fullscreen or maximized) |
| `extension/lib/prompt.js` | Builds the message that gets sent |
| `extension/options.*` | Settings page |

**If Claude or ChatGPT change their page and auto-send stops working**, the selectors at the top of `extension/inject.js` are what need updating.

## Tests

```bash
npm test            # unit tests (Node 20+)
npm run test:e2e    # real-browser scenarios against fake claude.ai / chatgpt.com pages (needs Playwright)
npm run test:e2e -- chatgpt   # only scenarios whose name contains "chatgpt"
```

## Guidelines

- Keep it build-free and dependency-free inside `extension/`.
- No API keys and no calls to private AI APIs. AskHere only opens the normal websites and types into them like a person would.
- Add a test for bug fixes where you can.
