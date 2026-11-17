/*
 * A section heading between the plugin's settings (Vencord lists settings without
 * groups, so these are component "settings" with no value).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";

import { cl } from "./state";

export function SettingsHeader({ title, description, first }: { title: string; description?: string; first?: boolean; }) {
    return (
        <div className={cl("settings-header")}>
            {!first && <Divider />}
            <Heading tag="h3">{title}</Heading>
            {description && <Paragraph className={cl("muted")}>{description}</Paragraph>}
        </div>
    );
}
