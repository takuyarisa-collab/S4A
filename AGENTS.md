# AGENTS.md

## Cursor Cloud specific instructions

### Project overview
Single-page canvas drawing game ("Loop Suction Prototype") built with **Vite 7 + TypeScript**. No backend, no database, no external services. The entire app runs client-side on an HTML Canvas.

### Available npm scripts
| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (default port 5173) |
| `npm run build` | Production build to `dist/` |
| `npm run typecheck` | `tsc --noEmit` — strict type checking |
| `npm run preview` | Preview production build |

### Known issues
- `npm run typecheck` reports pre-existing TS2018047 errors (`'ctx' is possibly 'null'`). These exist in the upstream code and do not block the build or dev server — Vite transpiles without type-checking.

### Running the dev server
```
npm run dev -- --host 0.0.0.0 --port 5173
```
Pass `--host 0.0.0.0` when running in Cloud Agent VMs so the browser can reach the server.

### No automated test suite
This project has no test framework or test files. Validation is manual: open the app in a browser, draw on the canvas, and verify the timer, line rendering, and loop-absorption animation work.
