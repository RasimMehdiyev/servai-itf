# ServAI UI

Tablet-first React prototype for the ServAI operational workflow interface.

## Screens

1. **Live** (`/live`) — Current task status, attention panel, workflow timeline
2. **History** (`/history`) — Performance metrics, stacked bar chart, top failures
3. **Day Details** (`/history/:dayId`) — Day summary + individual order list
4. **Assistant** (`/assistant`) — Stub
5. **Settings** (`/settings`) — Stub

## Architecture

- **Components** — Reusable UI primitives under `src/components/ui/` and layout shells under `src/components/layout/`
- **Features** — Feature-specific components, hooks, and pages under `src/features/{live,history,day-details}/`
- **Hooks** — Shared data hooks under `src/hooks/` exposing `{data, loading, error}`
- **Services** — API abstraction under `src/services/` — currently returning mock data via `Promise.resolve()`
- **Mocks** — Static data under `src/mocks/` matching the screenshot structure
- **Theme** — Design tokens under `src/theme/tokens.js`

## Accessibility

- CVD-friendly palette: blue/orange primary pair; darker green, clear red; never color-alone for meaning
- Icons + labels + shapes used alongside status colors
- Semantic HTML, ARIA labels, focus-visible states
- Touch targets ≥ 44×44px

## Target devices

iPad Mini (744×1133), iPad Air (820×1180), iPad Pro 11" (834×1194), iPad Pro 12.9" (1024×1366)

## Quick start

```bash
npm install
npm run dev
```
