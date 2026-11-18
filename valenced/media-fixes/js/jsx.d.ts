/*
 * Types for the classic JSX pragma the .tsx files use (see lazy.ts for why).
 * TypeScript looks for the JSX namespace under the pragma's first name
 * (`valenced`), finds none and falls back to a global `JSX`, which React 19's
 * types no longer declare. This maps the global one to React's.
 */

import type { JSX as ReactJSX } from "react";

declare global {
    namespace JSX {
        type Element = ReactJSX.Element;
        type ElementType = ReactJSX.ElementType;
        interface ElementClass extends ReactJSX.ElementClass { }
        interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty { }
        interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute { }
        type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
        interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes { }
        interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> { }
        interface IntrinsicElements extends ReactJSX.IntrinsicElements { }
    }
}
