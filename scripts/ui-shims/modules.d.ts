// Check-only module shims (see global-jsx.d.ts). Loose on purpose for
// third-party UI libraries; React hooks are typed generically so state and
// props built from the core types are still checked strictly.

declare module "react" {
  export type ReactNode = React.ReactNode;
  export type ErrorInfo = { componentStack?: string | null };
  export type ButtonHTMLAttributes<T> = React.ButtonHTMLAttributes<T>;
  export type HTMLAttributes<T> = React.HTMLAttributes<T>;
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => unknown>(callback: T, deps: readonly unknown[]): T;
  export interface RefObject<T> {
    current: T;
  }
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useRef<T = undefined>(): RefObject<T | undefined>;
  export function useId(): string;
  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => JSX.Element;
  }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export type ComponentType<P = any> = ((props: P) => ReactNode) | (new (props: P) => Component<P, any>);
  export function lazy<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): T;
  export const Suspense: (props: { fallback?: ReactNode; children?: ReactNode }) => JSX.Element;
  export const StrictMode: (props: { children?: ReactNode }) => JSX.Element;
  export const Fragment: (props: { children?: ReactNode }) => JSX.Element;
  export class Component<P = {}, S = {}> {
    constructor(props: P);
    props: Readonly<P>;
    state: S;
    setState(state: Partial<S> | ((previous: S) => Partial<S>)): void;
    render(): ReactNode;
  }
  const ReactDefault: {
    StrictMode: typeof StrictMode;
    Fragment: typeof Fragment;
  };
  export default ReactDefault;
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module "react-dom/client" {
  const ReactDOM: { createRoot(element: Element): { render(node: React.ReactNode): void } };
  export default ReactDOM;
}

declare module "react-router-dom" {
  export const BrowserRouter: (props: any) => JSX.Element;
  export const Routes: (props: any) => JSX.Element;
  export const Route: (props: any) => JSX.Element;
  export const Link: UIShim.LooseComponent;
  export const NavLink: (props: any) => JSX.Element;
  export const Navigate: (props: any) => JSX.Element;
  export function useLocation(): { pathname: string; search: string; hash: string; state: unknown };
  export function useNavigate(): (to: string | number, options?: { replace?: boolean }) => void;
}

declare module "class-variance-authority" {
  export function cva(base: string, config?: any): (props?: any) => string;
  export type VariantProps<_T> = { [variant: string]: any };
}

declare module "clsx" {
  export function clsx(...inputs: any[]): string;
}

declare module "tailwind-merge" {
  export function twMerge(...inputs: string[]): string;
}

declare module "lucide-react";
declare module "recharts" {
  export const Area: UIShim.LooseComponent;
  export const CartesianGrid: UIShim.LooseComponent;
  export const ComposedChart: UIShim.LooseComponent;
  export const Line: UIShim.LooseComponent;
  export const ResponsiveContainer: UIShim.LooseComponent;
  export const Tooltip: UIShim.LooseComponent;
  export const XAxis: UIShim.LooseComponent;
  export const YAxis: UIShim.LooseComponent;
}
declare module "@radix-ui/react-dialog" {
  export const Root: UIShim.LooseComponent;
  export const Trigger: UIShim.LooseComponent;
  export const Portal: UIShim.LooseComponent;
  export const Overlay: UIShim.LooseComponent;
  export const Content: UIShim.LooseComponent;
  export const Title: UIShim.LooseComponent;
  export const Description: UIShim.LooseComponent;
  export const Close: UIShim.LooseComponent;
}
declare module "@radix-ui/react-slider" {
  export const Root: UIShim.LooseComponent;
  export const Track: UIShim.LooseComponent;
  export const Range: UIShim.LooseComponent;
  export const Thumb: UIShim.LooseComponent;
}
declare module "@radix-ui/react-slot" {
  export const Slot: UIShim.LooseComponent;
}
declare module "@radix-ui/react-tooltip";
declare module "@fontsource-variable/inter";
declare module "*.css";
