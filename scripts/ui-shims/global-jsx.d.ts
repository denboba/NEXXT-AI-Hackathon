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
  /** Minimal synthetic mouse event (the subset of React.MouseEvent handlers commonly read). */
  interface MouseEvent<T = Element> {
    currentTarget: T;
    target: EventTarget;
    defaultPrevented: boolean;
    button: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  }
  /** Stand-in for csstype's CSSProperties: property names are not checked. */
  type CSSProperties = { [property: string]: string | number | undefined };
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
  /**
   * The common HTML attributes that third-party components in modules.d.ts
   * forward to their DOM element. Unknown camelCase props are rejected;
   * hyphenated props (aria-*, data-*) are accepted by TypeScript on any
   * component, as with the real types.
   */
  type ElementProps<T = Element> = {
    children?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    id?: string;
    title?: string;
    role?: string;
    tabIndex?: number;
    onClick?: (event: React.MouseEvent<T>) => void;
  };
}
