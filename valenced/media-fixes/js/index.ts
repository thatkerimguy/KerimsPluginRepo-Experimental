/*
 * Media Fixes for Valenced (plugin id thatkerimguy.media-fixes)
 *
 * Fixes two Discord bugs on Android:
 * - videos that play as a black screen with only sound (the phone's hardware
 *   decoder can't handle the video, and Discord turns the picture off);
 * - videos and voice messages that start playing by themselves in the
 *   background, or twice at once.
 *
 * Both are in Discord's native player code, so the fixes are in the native part
 * (src/main/kotlin, see MediaFixes.kt). This script only adds the settings page.
 */

import SettingsComponent from "./settings";

export default plugin({
    start() { },
    SettingsComponent,
});
