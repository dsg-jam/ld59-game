# Code Standards Checklist

This document maps each quality-guide area to concrete acceptance criteria that
every PR must satisfy before merge.  CI enforces the automated checks; the
manual items are reviewed in code review.

---

## 1. Automated gate (CI — `lint.yml`)

| Check | Command | Must pass |
|---|---|---|
| Svelte type-check | `npm run check` | ✅ zero errors |
| TypeScript typecheck | `npm run typecheck` | ✅ zero errors |
| ESLint (incl. svelte-a11y) | `npm run lint` | ✅ zero warnings/errors |
| Prettier formatting | `npx prettier --check .` | ✅ no diff |
| No plain JS files | `npm run ban-js` | ✅ passes |

> **Svelte accessibility warnings are treated as blockers.**  
> A `svelte-ignore a11y-*` comment requires an explicit justification comment
> approved in code review.

---

## 2. Performance acceptance criteria

- [ ] **No duplicate font loading** — Google Fonts `<link>` tags live only in
  `src/routes/+layout.svelte`; individual route pages must not repeat them.
- [ ] **Dynamic game imports** — every game module is loaded with
  `void import("$lib/games/<name>/main")` inside `onMount`, never at the top
  level of a route component.
- [ ] **Bundle hygiene** — large game engines (Three.js, PeerJS) must not appear
  in the main chunk.  Verify with `npm run build` and inspect `dist/` chunk
  sizes; no single game chunk should exceed 500 kB gzipped without documented
  justification.
- [ ] **Lighthouse baseline** — run `npx lighthouse <url> --output json` for `/`
  and each `/games/*` route after every significant change.  Performance score
  must not regress below 70; Accessibility must not regress below 90.

---

## 3. Accessibility acceptance criteria

- [ ] **Form control labels** — every `<input>`, `<select>`, and `<textarea>`
  must have either a `<label for="…">` or an explicit `aria-label`/
  `aria-labelledby` attribute.  Placeholder text alone is insufficient.
- [ ] **Canvas fallback** — every `<canvas>` must carry an `aria-label` and
  contain meaningful fallback text between the tags for screen-reader users.
- [ ] **Live regions** — status and log areas that change dynamically must use
  `role="status"` / `aria-live="polite"` (or `aria-live="assertive"` for
  urgent alerts).  Use `polite` by default; reserve `assertive` for errors that
  require immediate attention.
- [ ] **Dialog semantics** — every modal overlay must have `role="dialog"`,
  `aria-modal="true"`, and `aria-labelledby` pointing to the dialog's heading.
  Focus must move into the dialog on open and return to the trigger on close.
- [ ] **Keyboard parity** — all interactive elements reachable by mouse must also
  be reachable and operable by keyboard.  Game-engine code that creates DOM
  elements at runtime (e.g. board cells, cable layers) must add appropriate
  `tabindex` and `keydown` handlers where click handlers exist.
- [ ] **Unique page titles** — every route must provide a `<svelte:head><title>`
  that is descriptive and unique across routes.

---

## 4. TypeScript acceptance criteria

- [ ] **No `any` escapes** — `@typescript-eslint/no-explicit-any` is on; use
  `unknown` + type narrowing instead.
- [ ] **No broad DOM assertions** — `as HTMLInputElement` and similar casts must
  be replaced with typed query-helper wrappers that also perform null checks.
- [ ] **No `window as GameWindow`** — game engines communicate with Svelte
  components via the typed `deconstructApi` registry (or equivalent module-level
  API) rather than attaching callbacks to `window`.
- [ ] **Explicit TS config options** — `tsconfig.json` must specify `target`,
  `verbatimModuleSyntax`, and `strict`.  Do not rely solely on the generated
  `.svelte-kit/tsconfig.json`.
- [ ] **Shared prop interfaces** — component props that appear in more than one
  file must be extracted into a shared type in `$lib/types.ts` (or a
  domain-specific types file).

---

## 5. Svelte best-practice acceptance criteria

- [ ] **Lifecycle-managed listeners** — `window`, `document`, and `canvas`
  event listeners attached by game engines must be added on mount and removed on
  destroy (or via an explicit teardown contract called from the route's
  `onDestroy`).
- [ ] **No index keys in `{#each}`** — keyed `{#each items as item (item.id)}`
  is required; using the loop index as a key is prohibited.
- [ ] **Derived state over effect-driven sync** — prefer `$derived` /
  `$derived.by` over `$effect` that writes back to another reactive variable.
- [ ] **No `svelte-ignore`** without justification (see §1).

---

## 6. Rollout phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Accessibility blockers (labels, live regions, dialog semantics) | ✅ done |
| 2 | Font centralization, preload hook, teardown contracts | 🔄 in progress |
| 3 | TS config hardening, DOM typing, global-callback removal | 🔄 in progress |
| 4 | Re-audit, freeze standards, update this document | ⬜ pending |
