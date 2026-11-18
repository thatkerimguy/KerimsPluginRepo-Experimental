/*
 * Valenced evaluates the plugin's script at the pre-init stage of app boot,
 * before Discord's modules (design, tokens, actions), React and React Native
 * are loaded. Reading them there throws, and Valenced then turns the plugin off
 * (and it stays broken until it's reinstalled). So nothing may read them at
 * module level: build such values on first use with `lazy`.
 *
 * JSX has the same problem. The template compiles it to the automatic runtime,
 * which the build reads once when the script is evaluated. Each .tsx file
 * therefore starts with a classic runtime pragma that looks up
 * `valenced.react.React` on every render instead.
 */

/** A value made by `make` the first time it's needed */
export function lazy<T>(make: () => T): () => T {
    let made = false;
    let value: T;
    return () => {
        if (!made) {
            value = make();
            made = true;
        }
        return value;
    };
}
