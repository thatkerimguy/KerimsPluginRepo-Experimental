# Media Fixes (Valenced, Android)

Fixes two Discord bugs with videos on Android. Separate from the other plugins in this repo: no shared code, no dependencies.

Status: **0.1, not yet checked on a device.** Everything below comes from reading Discord 352.6's code (decompiled) and has to be confirmed on a phone.

## 1. Black video, only the sound plays

**Cause (Discord 352.6).** Chat videos use ExoPlayer 2.19.1 inside Discord. Discord builds its players (`od.e0`) with **decoder fallback off**, so when the phone's hardware decoder can't start or can't decode a video (AV1, HEVC, 10-bit or very high resolution videos on phones whose decoder can't handle them), ExoPlayer doesn't try any other decoder. Discord's error listener (`od.d`, log line "Disabling problematic renderer index …, retrying") then **turns the video renderer off and keeps playing**: sound over a black frame.

**Fix.**
- Decoder fallback is turned on (the only boolean argument of ExoPlayer's MediaCodecRenderer constructor), so ExoPlayer tries Android's software decoder when the hardware one fails to start.
- The plugin watches Android's `MediaCodec` on ExoPlayer's threads. A hardware video decoder that throws, reports an error, or takes in 90 frames over 4 seconds without giving one picture back is remembered, with the smallest size it failed at. From then on it's skipped for that format at that size or larger, so the software decoder takes over right away. Only done when Android has a software decoder for the format.
- When Discord's error listener is about to turn the picture off right after such a failure, the plugin prepares the player again instead (at most twice a minute per player). The video comes back with the software decoder.
- If nothing can decode it, Discord's own handling runs and a short message says the phone can't show that kind of video.

**Can't be fixed:** a phone with **no decoder at all** for the format (for example AV1 on older Android versions) gets no picture: ExoPlayer leaves the video track out without an error. Software decoding of a 4K video may also be slow on older phones.

## 2. Videos playing by themselves in the background

**Causes (Discord 352.6).**
- The voice message player (`da.d`) resumes "the last player" whenever audio focus comes back (`da.a`): after another app, a notification or something else in Discord briefly took the audio, it plays again, even with Discord in the background.
- react-native-video's view resumes its player when the React host resumes, also for views that are no longer on screen.
- Nothing checks that Discord is visible, or that the video is still on screen, so the sound has no controls to stop it.

**Fix.**
- **No playing in the background:** while no Discord screen is visible (a picture-in-picture window counts as visible), no ExoPlayer in Discord may start: `setPlayWhenReady(true)` becomes `false`, and a player whose sound starts anyway is paused. When Discord leaves the screen, everything playing is paused. Voice and video calls aren't ExoPlayer and aren't affected.
- **One video with sound at a time:** when a player's sound starts, other players that are playing with sound are paused. Muted and GIF-like videos (no audio track) don't count.
- **Stop all media** in the settings pauses every player Discord has, including ones you can't see.

## How it finds things

Nothing depends on 352.6's obfuscated names, so it should keep working across Discord updates:

| What | How it's found |
|---|---|
| ExoPlayer's player class | DexKit: the class with the string "SurfaceTextureListener already unset or replaced." |
| `setPlayWhenReady` / `prepare` | Its `(boolean)void` / `()void` method calling `(int, boolean): int` and `(int, int, boolean): void` |
| Volume | The player class's only float field |
| Decoder fallback switch | DexKit: the class with "Preferred decoder instantiation failed…", its constructor's only boolean |
| Discord's video error listener | DexKit: the method with "Disabling problematic renderer index" |
| Decoders, sound | Android framework: `MediaCodec`, `AudioTrack` (stable names) |

A part that isn't found is shown as "Not working" in the settings, and Discord's own behaviour stays.

## Settings

| Setting | Default |
|---|---|
| Fix black videos | on |
| No playing in the background | on |
| One video with sound at a time | on |
| Show messages | on |

Turning the plugin on while Discord runs takes effect after a restart (players that already exist were made without the fixes).

## Testing on a device

Log file (adb, no root): `/sdcard/Android/data/<Discord package>/files/media-fixes/log-<time>.log`. The settings page shows each part's status, the remembered decoder failures and the recent events.

1. **Black video:** play a video that was black with sound only (AV1 / HEVC / 4K). Expected: a message about software decoding, then the picture. The settings list the decoder under "Decoders". Play it again: it starts with the picture directly.
2. **Background:** play a video or voice message, leave Discord, play music in another app, pause it, play a notification sound. Expected: Discord stays silent. Back in Discord, nothing plays by itself.
3. **Duplicates:** play a video in chat, open it fullscreen. Expected: only one copy is heard.
4. **Not broken:** GIF-like videos keep autoplaying; Discord's mini player (scroll away from a playing video) keeps working; voice calls in the background keep their sound.

## Files

- `src/main/kotlin/dev/thatkerimguy/mediafixes/`: `MediaFixes.kt` (entry), `Runtime.kt` (start, bridge, toasts), `Players.kt` (fix 2), `Decoders.kt` (fix 1), `Foreground.kt` (is Discord visible), `Settings.kt`, `Log.kt`, `Reflect.kt`.
- `js/`: `index.ts` (plugin), `settings.tsx` (settings page), `native.ts` (bridge).
