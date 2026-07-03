# AGENTS.md

## Project Structure

- `index.html`: single-page prototype shell. Keep page containers and template hooks stable unless the UI change requires them.
- `app.js`: main client-side state, rendering, navigation, search, API fallback logic, and interactions.
- `styles.css`: all UI styling. Match the existing dense dashboard style; avoid marketing-page patterns.
- `server.py`: local read-only Python HTTP service and API routes.
- `stock_api_adapter.mjs`: local Node adapter for the A-share first fallback quote source.
- `package.json` / `package-lock.json`: pinned `stock-api` dependency; do not add unrelated frontend tooling.
- `data/bootstrap.json`: static fallback/bootstrap data used when the API is unavailable.
- `start.bat`: Windows launcher that selects port `5178`-`5185`, starts `server.py`, and opens the browser.
- `.agents/` and `.codex/`: local agent/tooling metadata. Do not depend on them for app runtime.

## Run Commands

- Preferred local run on Windows: `start.bat`
- Direct server run: `python server.py`
- Install the pinned quote adapter dependency: `npm install`
- Custom port: `$env:MIRABOARD_PORT=5179; python server.py`
- Custom Mira root: `$env:MIRABOARD_MIRA_ROOT="E:\path\to\Mira"; python server.py`
- Static-only inspection: open `index.html` directly. This must still avoid a blank screen by using `data/bootstrap.json` or embedded fallback data.

## Test Commands

- Run the backend suite with: `python -m unittest discover -s tests -v`
- Before finishing backend/API changes, run: `python -m py_compile server.py`
- Before finishing frontend changes, manually open the app through the local server and verify the touched flow in the browser.
- For API behavior, verify relevant endpoints with the running local server, especially `/api/health`, `/api/bootstrap`, `/api/research-index`, `/api/source-file`, `/api/quote`, and `/api/quotes` when those areas are changed.
- When editing `data/bootstrap.json`, validate JSON syntax before finishing.

## Code Style

- Keep the frontend and Python server framework-free. The pinned `stock-api` Node dependency is allowed only for the A-share fallback adapter.
- Use plain JavaScript, plain CSS, and Python standard library patterns already present in the repo.
- Preserve the local-first, read-only prototype model: API failures must fall back gracefully to `data/bootstrap.json` or embedded client data.
- Preserve UTF-8 encoding. Do not introduce new mojibake or widen existing encoding damage.
- In `server.py`, keep API responses JSON-shaped and explicit; validate paths before reading files.
- In `app.js`, prefer small helpers and existing render/update patterns over new frameworks or large abstractions.
- In `styles.css`, keep controls compact, information-dense, and consistent with the existing dashboard visual language.
- Keep UI text in Chinese unless the surrounding feature is already English-only.
- Avoid unrelated formatting churn in large files.

## Prohibited Actions

- Do not write to the adjacent Mira repository or any Mira research document from MiraBoard code unless the user explicitly requests and confirms a write workflow.
- Do not add automatic writeback to Mira; write actions must be preview-first and confirmation-gated.
- Do not expose arbitrary filesystem reads through `/api/source-file`; paths must remain constrained to the configured Mira root.
- Do not replace the lightweight prototype with a build system, framework, bundler, or package manager without explicit approval.
- Do not remove offline/static fallback behavior.
- Do not commit generated caches such as `__pycache__/`.
- Do not hardcode user-specific absolute paths in app code. `start.bat` is the only existing launcher exception.
- Do not show fake market data as real data; label unavailable or simulated states clearly.

## Definition of Done

- The requested behavior works through the normal local server flow.
- Static fallback still loads without a blank screen.
- Changed API routes return clear success/error JSON and do not crash on missing Mira folders or missing files.
- Changed UI remains usable at desktop size and does not overlap or overflow in the touched views.
- `python -m py_compile server.py` passes when `server.py` was changed.
- JSON files changed by the task parse successfully.
- The final response states what changed and what verification was run.

## Review Standard

- Prioritize issues that can cause data loss, unintended Mira writes, path traversal, fake/unclear investment data, broken fallback loading, or broken navigation.
- Check whether API changes preserve read-only boundaries and path safety.
- Check whether frontend changes handle API unavailable, empty data, loading, and error states.
- Check whether market quote behavior distinguishes live API results, unavailable data, and fallback/bootstrap data.
- Check whether Chinese text and UTF-8 content render correctly.
- Check whether changes are scoped to the requested feature and avoid broad rewrites of `app.js`, `styles.css`, or `server.py`.
