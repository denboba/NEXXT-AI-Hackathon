# Static review of the React UI (no install, no render)

This review records what was checked about the React UI in the build sandbox, how, and what was found. It is a substitute for checks that could not run, not an equivalent of them.

## What was not verified

- **Not compiled against the real type packages.** `npm ci` fails because the npm registry returns 403 Forbidden, and none of react, react-dom, react-router-dom, recharts, @radix-ui/*, lucide-react, vite, esbuild or express exists anywhere on disk. `npm run typecheck` (real `@types/react`, `@types/react-dom`, library typings and the project's TypeScript 7) and `npm run build` were not run.
- **Not bundled and not rendered.** A Chromium for Testing binary and `playwright-core` (inside a global tool package) are present in the sandbox, but without React and a bundler there is no bundle to load, so no page was opened, no screenshot was taken and `npm run test:e2e` (including the axe checks) was not run. No React stand-in was written to fake a render.
- Runtime behaviour (routing, Radix focus handling, Recharts layout, console warnings) is reviewed against the documented library behaviour only, not observed.

Run `npm ci && npm run typecheck && npm run build && npm test && npm run test:e2e` locally before relying on the UI.

## What was checked

`npm run typecheck:ui-shim` (`tsc -p tsconfig.ui-check.json`, global TypeScript 5.9.2, strict) type-checks every file in `src`, including all `.tsx` files, against `scripts/ui-shims/global-jsx.d.ts` and `scripts/ui-shims/modules.d.ts`.

The shims are **hand-written approximations** of the public APIs of the versions in `package.json` (React 19, react-dom 19 client, React Router 7, Recharts 3, Radix Dialog 1, Slider 1 and Slot 1, lucide-react 1, class-variance-authority 0.7, clsx 2, tailwind-merge 3). They were written from the documented APIs and were not diffed against the real `.d.ts` files, so they can differ in details. In this round they replaced the previous loose stand-ins (`any` props, `UIShim.LooseComponent`, and blanket `declare module "lucide-react";` and `declare module "@radix-ui/react-tooltip";`):

- Only the exports the project imports are declared, so a removed, renamed or unused export fails the check.
- Each component has its documented props with required and optional members and callback signatures. Unknown camelCase props fail the check; hyphenated props (`aria-*`, `data-*`) are accepted on any component, as with the real types.
- `cva` infers variant names from its config, so a misspelt `variant` or `size` on `Button` fails.

Remaining loose spots, each listed in the `modules.d.ts` header: JSX intrinsic elements accept any attribute; `React.ButtonHTMLAttributes` and `React.CSSProperties` are records; `Slot` accepts extra attributes because `Button` spreads `ButtonHTMLAttributes` into it; Recharts row data and tick values are `any` (as in the real typings); `@fontsource-variable/inter` and `*.css` are side-effect imports. `@radix-ui/react-tooltip` is a dependency in `package.json` but is not imported anywhere in `src`, so it is not declared.

**Negative check.** To confirm the shims catch real mistakes, a temporary probe file (deleted afterwards, not committed) was type-checked with the same config. All of these failed as intended: importing `NavLink`, `HelpCircle` (old lucide name), `Pie` or `@radix-ui/react-tooltip`; `useRef()` without an argument (React 19); `ReactDOM.render` (removed in React 19); `BrowserRouter future={...}` (v6 future flags, removed in v7); `Link href` instead of `to`; `Route component` (v5 API); `ArrowRight sizes`; a Recharts `Tooltip` formatter typed `(v: number)`; `Dialog.Root onOpenChange` taking a string; `Slider.Root value={5}` and `onValueChange` taking a number; `Button variant="primary" size="large"`. One probe line was not caught: an `XAxis` `tickFormatter` returning `any`, because the tick value is `any` in Recharts 3 as well.

## Third-party APIs per file

Result "OK" means the usage type-checks against the shim signature and matches the documented behaviour on review.

| File | Library | APIs used | Shim signature checked against | Result |
| --- | --- | --- | --- | --- |
| `src/main.tsx` | react, react-dom/client, react-router-dom | default `React.StrictMode`; default `ReactDOM.createRoot(el).render(...)`; `BrowserRouter` (no props) | `createRoot(container: Element \| DocumentFragment, options?)` returning `Root { render, unmount }`; `BrowserRouter { basename?, children?, window? }` | OK (React 19 root API, no `ReactDOM.render`) |
| `src/App.tsx` | react, react-router-dom, lucide-react | `Component` error boundary with `getDerivedStateFromError` and `componentDidCatch(error, ErrorInfo)`; `Suspense fallback`; `lazy(() => import(...))`, including named exports mapped to `default`; `useEffect`; `Routes`, `Route path element`; `Link to`; `useLocation().pathname`; `ArrowRight`, `ShieldCheck` with `size` | `Route { path?, index?, caseSensitive?, element?, errorElement?, children? }`; `Location { pathname, search, hash, state, key }`; `lazy<T>(factory: () => Promise<{ default: T }>)` | OK |
| `src/Coach.tsx` | react, react-router-dom, lucide-react | `useRef<HTMLDivElement>(null)` passed as `ref`; `useRef<AbortController \| null>(null)`; `useState`, `useEffect`; `Link to className`; 12 icons with `size`, `strokeWidth`, `className` | React 19 `useRef<T>(initial: T \| null): RefObject<T \| null>`; `LucideProps { size?, color?, strokeWidth?, absoluteStrokeWidth?, className?, ... }` | OK |
| `src/Landing.tsx` | react, react-router-dom, lucide-react | `Link to`; 12 icons, including icons stored in arrays and rendered as `<Icon size={23} />` | `LucideIcon` component type | OK |
| `src/Onboarding.tsx` | react, react-router-dom, lucide-react | `Navigate to replace`; `useNavigate()` then `navigate("/account/invest")`; `useLocation().pathname`; `Link`; 12 icons | `Navigate { to, replace?, state?, relative? }`; `NavigateFunction (to: To, options?) => void \| Promise<void>` | OK (the returned promise is not needed here) |
| `src/Invest.tsx` | react, react-router-dom, lucide-react, local `Dialog` | `Navigate to replace`; `useNavigate`; `Link to onClick`; 17 icons | `Link` with `to: To` required and anchor props, `onClick(event: React.MouseEvent<HTMLAnchorElement>)` | OK |
| `src/DecisionLab.tsx` | react, react-router-dom, lucide-react, local `Dialog` | `useRef` for flags and the HTTP provider; `Link`; 8 icons | as above | OK |
| `src/EvalLab.tsx` | react, react-router-dom, lucide-react | `Link`; 6 icons with `size`, `aria-hidden`, `className` | as above | OK |
| `src/Growth.tsx` | react, react-router-dom, lucide-react | `Link`; 3 icons | as above | OK |
| `src/components/Layout.tsx` | react, react-router-dom, lucide-react, local `Dialog` | `Link to key onClick aria-label aria-current`; `useLocation`, `useNavigate`; 7 icons | as above | Fixed (see below) |
| `src/components/Simulator.tsx` | recharts, lucide-react, local `Dialog`, `Slider` | `ResponsiveContainer width="100%" height="100%"`; `ComposedChart data margin`; `<defs>` gradient child; `CartesianGrid strokeDasharray vertical stroke`; `XAxis dataKey axisLine tickLine tick tickFormatter minTickGap`; `YAxis` the same without `dataKey`; `Tooltip contentStyle formatter labelFormatter`; `Area dataKey type fill stroke strokeWidth isAnimationActive`; `Line dataKey type stroke strokeWidth strokeDasharray dot isAnimationActive` | `width/height: \`${number}%\` \| number`; `CurveType` union; `tickFormatter(value: any, index: number) => string`; `formatter(value, name, item, index, payload) => [ReactNode, NameType] \| ReactNode`; `labelFormatter(label, payload) => ReactNode` | Fixed (see below); parent `.chart-wrap` has a fixed CSS height (210px, 185px on small screens), as `ResponsiveContainer` requires |
| `src/components/ui/button.tsx` | @radix-ui/react-slot, class-variance-authority, clsx, tailwind-merge | `Slot` via `asChild`; `cva` with `variants` and `defaultVariants`; `VariantProps<typeof variants>`; `clsx`, `twMerge` | `cva<T>(base?, config?: Config<T>) => (props?: Props<T>) => string`; `VariantProps` omits `class`/`className`; `clsx(...inputs: ClassValue[])`; `twMerge(...classLists)` | OK; all `variant` and `size` values used in `src` are valid |
| `src/components/ui/dialog.tsx` | @radix-ui/react-dialog, lucide-react | `Root`, `Trigger asChild`, `Portal`, `Overlay className`, `Content className`, `Title`, `Description`, `Close aria-label` | `Root { open?, defaultOpen?, onOpenChange?(open: boolean), modal?, children? }`; `Trigger`/`Close` button props plus `asChild`; `Content` focus and dismiss callbacks | Fixed (see below); has a `Title` as Radix requires |
| `src/components/ui/slider.tsx` | @radix-ui/react-slider | `Root min max step value={[value]} onValueChange={(values) => onChange(values[0])}`; `Track`, `Range`, `Thumb aria-label aria-valuetext` | `value?: number[]`, `onValueChange?(value: number[]): void` | OK (value is an array, as Radix requires) |
| `src/components/decision/WorkflowViews.tsx` | react, lucide-react | `ReactNode` type; `ArrowRight`, `CornerUpLeft aria-hidden` | as above | OK |
| `src/lib/journey.tsx` | react | `createContext`, `useContext`, `Context.Provider value`, `useEffect`, `useState` | `Context<T> { Provider: (props: { value: T; children? }) }` | OK |

## Issues found and fixed

1. **`src/components/Layout.tsx` used the global `React` namespace without importing it** (`children?: React.ReactNode` in `PageIntro`). The shim declares a global `React` namespace, so the old check could not see it; with the real `@types/react` this relies on the UMD global. Changed to `import type { ReactNode } from "react"` and merged the duplicate `import { useState } from "react"` into the first React import.
2. **`src/components/ui/dialog.tsx` could render a Radix `Dialog.Content` without a `Description`.** Radix logs an accessibility warning when `Content` has neither a `Description` nor `aria-describedby={undefined}`. All six call sites already pass a description, so `description` is now a required prop and the `Description` is always rendered.
3. **`src/components/Simulator.tsx` nested a focusable chart inside `role="img"`.** Recharts 3 turns `accessibilityLayer` on by default, which makes the chart SVG keyboard-focusable. The wrapper `div` has `role="img"` with a full text summary in `aria-label`, and `img` children are presentational, so a focusable descendant conflicts with that role (axe rule `nested-interactive`, which the Playwright axe checks would report). Set `accessibilityLayer={false}` on `ComposedChart`; the text summary stays the accessible description of the chart.

4. **Em dashes in user-facing strings** (coach greeting in `src/Coach.tsx`, downloaded plan heading in `src/Invest.tsx`, note in `src/Onboarding.tsx`, mobile progress label in `src/components/Layout.tsx`) were replaced with commas or colons, per the project's writing convention. No test asserts these strings.

No API that React 19, React Router 7, Recharts 3 or Radix removed was found in `src`: no `ReactDOM.render`, string refs, `defaultProps`, `propTypes`, `findDOMNode` or `forwardRef`; no v6 future flags on `BrowserRouter`; no removed Recharts props such as `activeIndex` or `alwaysShow`; Slider values are arrays.

## Open risks

- **Icon names.** All 41 lucide icons use current lucide names (for example `CircleHelp`, `LoaderCircle`, `CircleCheck` rather than the old `HelpCircle`, `Loader2`, `CheckCircle`). The lucide-react 1.x export list could not be checked offline; `Fingerprint` in particular may have been renamed in recent lucide releases (possibly kept only as a deprecated alias); this could not be confirmed offline. `npm run typecheck` will report any missing name.
- **Shim drift.** If a real prop type is stricter than the shim (for example a narrower union), `npm run typecheck` can still fail where `typecheck:ui-shim` passes.
- **Runtime only.** Focus handling, layout, animation and console warnings are unobserved until the UI is built and rendered.
