/*
 * Discord's GIF picker modules and original components, filled in as the plugin finds them.
 */

import type { ReactNode } from "react";

export type AnyComponent = (props: any) => ReactNode;

export interface PickerUtils {
    GIF_PICKER_GUTTER_SPACING?: number;
    GIF_PICKER_ITEM_ESIMTATED_HEIGHT?: number;
}

export const pickerModules: {
    /** The original GIFPicker render function */
    picker?: AnyComponent;
    /** The original GIFPickerCategoriesPage render function */
    categoriesPage?: AnyComponent;
    utils?: PickerUtils;
    categoryView?: { default: AnyComponent; };
} = {};
