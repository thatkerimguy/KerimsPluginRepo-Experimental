/** @jsxRuntime classic */
/** @jsx valenced.react.React.createElement */
/** @jsxFrag valenced.react.React.Fragment */
/*
 * Small pieces for the settings: toasts and the confirm alert.
 */

import { AlertActionCreators, ToastActionCreators } from "@valenced/discord/actions";
import { Design } from "@valenced/discord/design";

export function toast(text: string) {
    ToastActionCreators.open("GIFS_PLUS", { text });
}

export function openConfirmAlert(options: { title: string; body: string; confirmText: string; destructive?: boolean; onConfirm(): void; }) {
    const { AlertActionButton, AlertModal } = Design;
    AlertActionCreators.openAlert("gifs-plus-confirm", (
        <AlertModal
            title={options.title}
            content={options.body}
            actions={
                <>
                    <AlertActionButton
                        text={options.confirmText}
                        variant={options.destructive ? "destructive" : "primary"}
                        onPress={options.onConfirm}
                    />
                    <AlertActionButton text="Cancel" variant="secondary" />
                </>
            }
        />
    ));
}
