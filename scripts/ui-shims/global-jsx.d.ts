// Check-only approximation of the React JSX/global types. Used ONLY by
// tsconfig.ui-check.json (npm run typecheck:ui-shim) while node_modules
// cannot be installed. It is NOT a substitute for `npm run typecheck`.
// Intrinsic elements are permissive; the goal is to type-check how TSX files
// use the framework-free core types (WorkflowState, ScenarioResult, ...).

declare namespace React {
  type ReactNode =
    | JSX.Element
    | string
    | number
    | bigint
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>;
  type ButtonHTMLAttributes<_T> = { [attribute: string]: any };
  type HTMLAttributes<_T> = { [attribute: string]: any };
}

declare namespace JSX {
  interface Element {
    type: unknown;
    props: unknown;
    key: string | null;
  }
  type ElementType = string | ((props: any) => React.ReactNode) | (new (props: any) => any);
  interface ElementClass {
    render(): React.ReactNode;
  }
  interface ElementAttributesProperty {
    props: {};
  }
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: string | number | null;
  }
  interface IntrinsicElements {
    [element: string]: UIShim.LooseProps;
  }
}

declare namespace UIShim {
  /** Any attribute; callback attributes get `any` parameters (like real DOM handlers would get typed events). */
  type LooseProps = {
    children?: React.ReactNode;
    [attribute: string]: ((...args: any[]) => any) | string | number | bigint | boolean | object | null | undefined;
  };
  type LooseComponent = (props: LooseProps) => JSX.Element;
}
