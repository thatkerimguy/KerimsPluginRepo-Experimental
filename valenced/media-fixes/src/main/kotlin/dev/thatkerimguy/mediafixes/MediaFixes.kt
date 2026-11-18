@file:JvmName("MediaFixes")

package dev.thatkerimguy.mediafixes

import app.valenced.plugins.plugin

/**
 * Media Fixes, native part (Android). Two Discord bugs, both in native code:
 *
 * 1. **Black video, sound only** ([Decoders]). Discord's chat player (ExoPlayer 2.19 inside Discord,
 *    built in `od.e0` on 352.6) is created with decoder fallback off, and its error listener
 *    (`od.d`, "Disabling problematic renderer index") answers a video decoder failure by turning
 *    the video renderer off and playing on: sound over a black frame. A hardware decoder that
 *    can't handle an AV1 / HEVC / high resolution video fails that way. The fix turns decoder
 *    fallback on, remembers which hardware decoder failed at which size, skips it next time so a
 *    software decoder takes over, and retries the video instead of letting Discord drop the picture.
 *
 * 2. **Videos playing by themselves in the background** ([Players]). Discord resumes "the last
 *    player" when audio focus comes back (`da.a`, voice messages) and react-native-video resumes
 *    on host resume, without checking that Discord is on screen or that the video still is. The
 *    fix stops any ExoPlayer in Discord from starting while no Discord screen is visible, pauses
 *    them when Discord leaves the screen, and lets only one video with sound play at a time.
 *
 * Everything is found by strings and shapes (DexKit) or is an Android framework method, so
 * nothing depends on 352.6's obfuscated names. A hook that isn't found is reported in the
 * settings and leaves Discord's own behaviour.
 */
@Suppress("UNUSED")
val mediaFixes = plugin {
    start {
        Runtime.start(this)
    }
    stop {
        Runtime.stop()
    }
}
