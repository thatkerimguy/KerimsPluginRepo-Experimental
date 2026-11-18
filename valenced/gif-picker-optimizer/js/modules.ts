/*
 * Discord's GIF picker modules and original components, filled in as the plugin finds them.
 */

import type { ReactNode } from "react";

export type AnyComponent = (props: any) => ReactNode;

export const pickerModules: {
    /** The original GIFPicker render function */
    picker?: AnyComponent;
} = {};
