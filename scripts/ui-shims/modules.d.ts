// Check-only module shims for `npm run typecheck:ui-shim` (tsconfig.ui-check.json).
//
// HAND-WRITTEN APPROXIMATIONS, NOT THE REAL TYPE PACKAGES. node_modules cannot
// be installed in the build sandbox (npm registry 403), so @types/react,
// @types/react-dom and the bundled .d.ts files of react-router-dom, recharts,
// @radix-ui/*, lucide-react, class-variance-authority, clsx and tailwind-merge
// are not available. Each declaration below was written from the documented
// public API of the version range in package.json (React 19, react-dom 19
// client, React Router 7, Recharts 3, Radix Dialog 1 / Slider 1 / Slot 1,
// lucide-react 1, class-variance-authority 0.7, clsx 2, tailwind-merge 3). They
// were not diffed against the real .d.ts files and may differ in details. The
// real check remains `npm run typecheck` with node_modules installed.
//
// Rules followed:
// - Only exports this project imports are declared, so importing a
//   non-existent or unused export fails the check.
// - Props are typed with required vs optional and callback signatures as
//   documented (for example Slider onValueChange(value: number[]), Dialog
//   onOpenChange(open: boolean), Recharts tickFormatter(value, index)). Unknown
//   camelCase props are rejected; hyphenated props (aria-*, data-*) are always
//   accepted by TypeScript, as with the real types.
// - Only the props of each component that are documented and plausibly useful
//   here are declared; real components accept more. A prop missing here is a
//   shim gap, not proof that the library lacks it.
//
// Remaining loose spots (deliberate):
// - JSX intrinsic elements (div, button, svg, ...) accept any attribute
//   (global-jsx.d.ts, UIShim.LooseProps), and React.ButtonHTMLAttributes is an
//   index signature, because typing all of the DOM by hand is out of scope.
// - React.CSSProperties is a string-keyed record (no csstype).
// - Slot also accepts any extra attribute, because button.tsx spreads the
//   (index-signature) ButtonHTMLAttributes into it; the real SlotProps is
//   React.HTMLAttributes<HTMLElement>.
// - Recharts `data` rows are `readonly any[]` and tick/axis value parameters
//   are `any`, matching the real Recharts 3 typings.
// - "@fontsource-variable/inter" and "*.css" are side-effect imports with no
//   exports, so blanket declarations are accurate.
// - "@radix-ui/react-tooltip" is in package.json but not imported anywhere in
//   src, so it is intentionally not declared (an import would fail the check).

declare module "react" {
  export type ReactNode = React.ReactNode;
  export type ErrorInfo = { componentStack?: string | null; digest?: string | null };
  export type ButtonHTMLAttributes<T> = React.ButtonHTMLAttributes<T>;
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  // React 19: RefObject.current is mutable and useRef requires an argument.
  export interface RefObject<T> {
    current: T;
  }
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useRef<T>(initial: T | undefined): RefObject<T | undefined>;
  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => JSX.Element;
  }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export type ComponentType<P = any> = ((props: P) => ReactNode) | (new (props: P) => Component<P, any>);
  export function lazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): T;
  export const Suspense: (props: { fallback?: ReactNode; children?: ReactNode; name?: string }) => JSX.Element;
  export const StrictMode: (props: { children?: ReactNode }) => JSX.Element;
  export class Component<P = {}, S = {}> {
    constructor(props: P);
    readonly props: Readonly<P>;
    state: Readonly<S>;
    setState(state: Partial<S> | ((previous: Readonly<S>, props: Readonly<P>) => Partial<S> | null) | null, callback?: () => void): void;
    forceUpdate(callback?: () => void): void;
    render(): ReactNode;
    componentDidMount?(): void;
    componentWillUnmount?(): void;
    componentDidCatch?(error: Error, errorInfo: ErrorInfo): void;
  }
  // `import React from "react"` (main.tsx) resolves to the CommonJS module
  // object via allowSyntheticDefaultImports; only StrictMode is read from it.
  const ReactDefault: {
    StrictMode: typeof StrictMode;
  };
  export default ReactDefault;
}

declare module "react/jsx-runtime" {
  export const jsx: (type: unknown, props: unknown, key?: string) => JSX.Element;
  export const jsxs: (type: unknown, props: unknown, key?: string) => JSX.Element;
  export const Fragment: (props: { children?: React.ReactNode }) => JSX.Element;
}

declare module "react-dom/client" {
  // React 19 removed ReactDOM.render; createRoot is the client entry point.
  export interface Root {
    render(children: React.ReactNode): void;
    unmount(): void;
  }
  export interface RootOptions {
    identifierPrefix?: string;
    onUncaughtError?: (error: unknown, errorInfo: { componentStack?: string }) => void;
    onCaughtError?: (error: unknown, errorInfo: { componentStack?: string }) => void;
    onRecoverableError?: (error: unknown, errorInfo: { componentStack?: string }) => void;
  }
  export function createRoot(container: Element | DocumentFragment, options?: RootOptions): Root;
  const ReactDOM: { createRoot: typeof createRoot };
  export default ReactDOM;
}

declare module "react-router-dom" {
  // React Router 7 (the react-router-dom package re-exports react-router).
  // Future flags such as v7_startTransition were removed in v7, so they are
  // not accepted on BrowserRouter.
  export interface Path {
    pathname: string;
    search: string;
    hash: string;
  }
  export type To = string | Partial<Path>;
  export interface Location<State = unknown> extends Path {
    state: State;
    key: string;
  }
  export type RelativeRoutingType = "route" | "path";
  export const BrowserRouter: (props: {
    basename?: string;
    children?: React.ReactNode;
    window?: Window;
  }) => JSX.Element;
  export const Routes: (props: { children?: React.ReactNode; location?: Partial<Location> | string }) => JSX.Element | null;
  export const Route: (props: {
    path?: string;
    index?: boolean;
    caseSensitive?: boolean;
    element?: React.ReactNode | null;
    errorElement?: React.ReactNode | null;
    children?: React.ReactNode;
  }) => JSX.Element | null;
  export const Link: (
    props: UIShim.ElementProps<HTMLAnchorElement> & {
      to: To;
      replace?: boolean;
      state?: unknown;
      relative?: RelativeRoutingType;
      reloadDocument?: boolean;
      preventScrollReset?: boolean;
      viewTransition?: boolean;
      discover?: "render" | "none";
      prefetch?: "none" | "intent" | "render" | "viewport";
      target?: string;
      rel?: string;
    },
  ) => JSX.Element;
  export const Navigate: (props: { to: To; replace?: boolean; state?: unknown; relative?: RelativeRoutingType }) => null;
  export function useLocation(): Location;
  export interface NavigateOptions {
    replace?: boolean;
    state?: unknown;
    preventScrollReset?: boolean;
    relative?: RelativeRoutingType;
    flushSync?: boolean;
    viewTransition?: boolean;
  }
  export interface NavigateFunction {
    (to: To, options?: NavigateOptions): void | Promise<void>;
    (delta: number): void | Promise<void>;
  }
  export function useNavigate(): NavigateFunction;
}

declare module "class-variance-authority" {
  // Mirrors the 0.7 typings: variant values are inferred from the config, so a
  // misspelt variant or size value fails the check.
  type ClassValue = string | number | bigint | boolean | null | undefined | ClassValue[] | { [key: string]: unknown };
  type ClassProp = { class?: ClassValue; className?: never } | { class?: never; className?: ClassValue } | { class?: never; className?: never };
  type StringToBoolean<T> = T extends "true" | "false" ? boolean : T;
  type ConfigSchema = Record<string, Record<string, ClassValue>>;
  type ConfigVariants<T extends ConfigSchema> = {
    [Variant in keyof T]?: StringToBoolean<keyof T[Variant]> | null | undefined;
  };
  type Config<T> = T extends ConfigSchema
    ? {
        variants?: T;
        defaultVariants?: ConfigVariants<T>;
        compoundVariants?: (ConfigVariants<T> & ClassProp)[];
      }
    : never;
  type Props<T> = T extends ConfigSchema ? ConfigVariants<T> & ClassProp : ClassProp;
  type OmitUndefined<T> = T extends undefined ? never : T;
  export function cva<T>(base?: ClassValue, config?: Config<T>): (props?: Props<T>) => string;
  export type VariantProps<Component extends (...args: any) => any> = Omit<
    OmitUndefined<Parameters<Component>[0]>,
    "class" | "className"
  >;
}

declare module "clsx" {
  export type ClassDictionary = Record<string, any>;
  export type ClassArray = ClassValue[];
  export type ClassValue = ClassArray | ClassDictionary | string | number | bigint | null | boolean | undefined;
  export function clsx(...inputs: ClassValue[]): string;
}

declare module "tailwind-merge" {
  type ClassNameValue = ClassNameValue[] | string | null | undefined | 0 | 0n | false;
  export function twMerge(...classLists: ClassNameValue[]): string;
}

declare module "lucide-react" {
  // Icons are components rendering an <svg>; LucideProps = SVG attributes plus
  // size and absoluteStrokeWidth. Icon names follow current lucide naming
  // (for example CircleHelp, LoaderCircle, CircleCheck); they could not be
  // checked against the lucide-react 1.x export list offline.
  export type LucideProps = UIShim.ElementProps<SVGSVGElement> & {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  };
  export type LucideIcon = (props: LucideProps) => JSX.Element;
  export const ArrowDown: LucideIcon;
  export const ArrowDownToLine: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const ArrowUpRight: LucideIcon;
  export const CalendarDays: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const CircleCheck: LucideIcon;
  export const CircleHelp: LucideIcon;
  export const Clock3: LucideIcon;
  export const Coins: LucideIcon;
  export const CornerUpLeft: LucideIcon;
  export const Download: LucideIcon;
  export const Fingerprint: LucideIcon;
  export const FlaskConical: LucideIcon;
  export const HeartHandshake: LucideIcon;
  export const Info: LucideIcon;
  export const Landmark: LucideIcon;
  export const Leaf: LucideIcon;
  export const LoaderCircle: LucideIcon;
  export const LockKeyhole: LucideIcon;
  export const Mail: LucideIcon;
  export const Menu: LucideIcon;
  export const MessageCircle: LucideIcon;
  export const Play: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const RotateCcw: LucideIcon;
  export const Send: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const SlidersHorizontal: LucideIcon;
  export const Sparkles: LucideIcon;
  export const Sprout: LucideIcon;
  export const Terminal: LucideIcon;
  export const Trash2: LucideIcon;
  export const TrendingDown: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const UserRound: LucideIcon;
  export const Wallet: LucideIcon;
  export const X: LucideIcon;
}

declare module "recharts" {
  // Recharts 3. accessibilityLayer defaults to true in v3.
  type Percent = `${number}%`;
  type DataKey = string | number | ((row: any) => unknown);
  type CurveType =
    | "basis"
    | "basisClosed"
    | "basisOpen"
    | "bumpX"
    | "bumpY"
    | "bump"
    | "linear"
    | "linearClosed"
    | "natural"
    | "monotoneX"
    | "monotoneY"
    | "monotone"
    | "step"
    | "stepBefore"
    | "stepAfter";
  type Margin = { top?: number; right?: number; bottom?: number; left?: number };
  type AnimationProps = {
    isAnimationActive?: boolean | "auto";
    animationDuration?: number;
    animationEasing?: "ease" | "ease-in" | "ease-out" | "ease-in-out" | "linear";
  };
  type SeriesProps = AnimationProps & {
    dataKey: DataKey;
    type?: CurveType;
    name?: string | number;
    stroke?: string;
    strokeWidth?: number | string;
    strokeDasharray?: string | number;
    dot?: boolean | object | React.ReactNode | ((props: any) => React.ReactNode);
    activeDot?: boolean | object | React.ReactNode | ((props: any) => React.ReactNode);
    connectNulls?: boolean;
    legendType?: "line" | "plainline" | "square" | "rect" | "circle" | "cross" | "diamond" | "star" | "triangle" | "wye" | "none";
    unit?: string | number;
    hide?: boolean;
    xAxisId?: string | number;
    yAxisId?: string | number;
    className?: string;
  };
  type AxisProps = {
    dataKey?: DataKey;
    type?: "number" | "category";
    hide?: boolean;
    axisLine?: boolean | object;
    tickLine?: boolean | object;
    tick?: boolean | object | React.ReactNode | ((props: any) => React.ReactNode);
    tickFormatter?: (value: any, index: number) => string;
    tickCount?: number;
    tickMargin?: number;
    minTickGap?: number;
    interval?: number | "preserveStart" | "preserveEnd" | "preserveStartEnd" | "equidistantPreserveStart";
    domain?: readonly unknown[] | ((dataMinMax: [number, number]) => [number, number]);
    allowDecimals?: boolean;
    unit?: string | number;
    width?: number | "auto";
    height?: number;
    orientation?: "top" | "bottom" | "left" | "right";
    padding?: { left?: number; right?: number; top?: number; bottom?: number };
  };
  type ValueType = number | string | ReadonlyArray<number | string>;
  type NameType = number | string;
  interface TooltipPayloadEntry {
    value?: ValueType;
    name?: NameType;
    dataKey?: DataKey;
    payload?: any;
    color?: string;
    unit?: string | number;
  }
  type Formatter = (
    value: ValueType,
    name: NameType,
    item: TooltipPayloadEntry,
    index: number,
    payload: ReadonlyArray<TooltipPayloadEntry>,
  ) => [React.ReactNode, NameType] | React.ReactNode;

  export const ResponsiveContainer: (props: {
    width?: Percent | number;
    height?: Percent | number;
    aspect?: number;
    minWidth?: Percent | number;
    minHeight?: Percent | number;
    maxHeight?: number;
    debounce?: number;
    initialDimension?: { width: number; height: number };
    onResize?: (width: number, height: number) => void;
    id?: string | number;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
  }) => JSX.Element;
  export const ComposedChart: (props: {
    data?: readonly any[];
    margin?: Margin;
    width?: number;
    height?: number;
    layout?: "horizontal" | "vertical";
    syncId?: string | number;
    accessibilityLayer?: boolean;
    title?: string;
    desc?: string;
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }) => JSX.Element;
  export const Area: (props: SeriesProps & { fill?: string; fillOpacity?: number | string; stackId?: string | number; baseValue?: number | "dataMin" | "dataMax" }) => JSX.Element;
  export const Line: (props: SeriesProps) => JSX.Element;
  export const CartesianGrid: (props: {
    horizontal?: boolean;
    vertical?: boolean;
    stroke?: string;
    strokeDasharray?: string | number;
    fill?: string;
    fillOpacity?: number;
    xAxisId?: string | number;
    yAxisId?: string | number;
  }) => JSX.Element;
  export const XAxis: (props: AxisProps & { xAxisId?: string | number }) => JSX.Element;
  export const YAxis: (props: AxisProps & { yAxisId?: string | number }) => JSX.Element;
  export const Tooltip: (props: AnimationProps & {
    formatter?: Formatter;
    labelFormatter?: (label: any, payload: ReadonlyArray<TooltipPayloadEntry>) => React.ReactNode;
    content?: React.ReactNode | ((props: any) => React.ReactNode);
    contentStyle?: React.CSSProperties;
    itemStyle?: React.CSSProperties;
    labelStyle?: React.CSSProperties;
    wrapperStyle?: React.CSSProperties;
    cursor?: boolean | object | React.ReactNode;
    separator?: string;
    offset?: number;
    trigger?: "hover" | "click";
    defaultIndex?: number | string;
    filterNull?: boolean;
  }) => JSX.Element | null;
}

declare module "@radix-ui/react-dialog" {
  // Radix Dialog 1.x. Content warns at runtime without a Title, and without a
  // Description unless aria-describedby={undefined} is passed.
  type AsChild = { asChild?: boolean };
  type ButtonProps = UIShim.ElementProps<HTMLButtonElement> & AsChild & { type?: "button" | "submit" | "reset"; disabled?: boolean };
  type FocusOutsideHandler = (event: Event) => void;
  export const Root: (props: {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    modal?: boolean;
    children?: React.ReactNode;
  }) => JSX.Element;
  export const Trigger: (props: ButtonProps) => JSX.Element;
  export const Portal: (props: { container?: Element | DocumentFragment | null; forceMount?: true; children?: React.ReactNode }) => JSX.Element;
  export const Overlay: (props: UIShim.ElementProps<HTMLDivElement> & AsChild & { forceMount?: true }) => JSX.Element | null;
  export const Content: (
    props: UIShim.ElementProps<HTMLDivElement> &
      AsChild & {
        forceMount?: true;
        onOpenAutoFocus?: (event: Event) => void;
        onCloseAutoFocus?: (event: Event) => void;
        onEscapeKeyDown?: (event: KeyboardEvent) => void;
        onPointerDownOutside?: FocusOutsideHandler;
        onInteractOutside?: FocusOutsideHandler;
      },
  ) => JSX.Element | null;
  export const Title: (props: UIShim.ElementProps<HTMLHeadingElement> & AsChild) => JSX.Element;
  export const Description: (props: UIShim.ElementProps<HTMLParagraphElement> & AsChild) => JSX.Element;
  export const Close: (props: ButtonProps) => JSX.Element;
}

declare module "@radix-ui/react-slider" {
  // Radix Slider 1.x: value / defaultValue are arrays (one entry per thumb).
  type AsChild = { asChild?: boolean };
  export const Root: (
    props: UIShim.ElementProps<HTMLSpanElement> &
      AsChild & {
        value?: number[];
        defaultValue?: number[];
        onValueChange?: (value: number[]) => void;
        onValueCommit?: (value: number[]) => void;
        min?: number;
        max?: number;
        step?: number;
        minStepsBetweenThumbs?: number;
        orientation?: "horizontal" | "vertical";
        dir?: "ltr" | "rtl";
        inverted?: boolean;
        disabled?: boolean;
        name?: string;
        form?: string;
      },
  ) => JSX.Element;
  export const Track: (props: UIShim.ElementProps<HTMLSpanElement> & AsChild) => JSX.Element;
  export const Range: (props: UIShim.ElementProps<HTMLSpanElement> & AsChild) => JSX.Element;
  export const Thumb: (props: UIShim.ElementProps<HTMLSpanElement> & AsChild & { name?: string }) => JSX.Element;
}

declare module "@radix-ui/react-slot" {
  // Slot merges its props onto its single child element.
  export const Slot: (props: UIShim.ElementProps<HTMLElement> & { [attribute: string]: unknown }) => JSX.Element;
}

declare module "@fontsource-variable/inter";
declare module "*.css";
