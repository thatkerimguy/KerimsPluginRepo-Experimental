# Chat Islands (Valenced, Android)

A library plugin: other plugins draw **React Native components inside Discord's chat messages**. Discord's mobile chat is drawn by native code from row data, so a plugin can't put its own views in a message on its own. Chat Islands puts a placeholder in the row data and shows a React surface exactly where it's drawn. It scrolls with the message in the same frame, and the chat's own scrolling keeps working.

Status: **0.1, phase 0**. Not yet checked on a device: see `TESTING.md` ("Chat Islands phase 0") and `SOCIAL_EMBEDS_PLAN.md` (section 4). The API below may still change before 1.0.

## Using it

`manifest.json` of your plugin:

```json
"dependencies": {
    "valenced.api": { "version": ">=1 <2" },
    "discord": { "version": "*" },
    "thatkerimguy.chat-islands": { "version": ">=0.1 <0.2" }
}
```

Your plugin then gets `chatIslands` in its plugin API (types in `js/api.ts`):

```tsx
export default plugin({
    start({ chatIslands, cleanup }) {
        cleanup(chatIslands.register({
            id: "my-islands",
            // Fast and synchronous: runs while chat rows are built
            match: message => message.content.includes("hello")
                ? [{ id: "hello", replacesEmbed: null, data: null }]
                : null,
            // Optional: load what the island needs; until then Discord's embed stays
            prepare: async (slot, message) => { /* fetch, cache */ },
            component: ({ islandKey, width, measuring }) => <MyCard islandKey={islandKey} width={width} />,
        }));
    },
});
```

- `replacesEmbed`: the index of the Discord embed your island takes the place of (e.g. the embed of the link it's for), or `null` to add it after the embeds.
- Each island is measured off screen at the chat width before it's shown, so its row is the right size from the first frame. Call `chatIslands.resize(islandKey)` when its content changes size.
- `useIslandState(islandKey, name, initial)` keeps state while the island's view is reused for other messages during scrolling. Plain `useState` is lost then.
- `useIslandVisible(islandKey)` says whether it's on screen (pause video and animations when it isn't).
- `openMessageMenu(message)` opens Discord's long-press menu, for islands that handle long presses themselves.
- When islands can't be shown (no native part, a Discord update moved the hook point), `isAvailable()` is false and every message keeps Discord's own embed. Your plugin needs no fallback code.

## Rules for island components

- Colours only from Discord's theme tokens (`Tokens`, `Design.createStyles`), so islands follow every theme.
- Keep renders cheap. Islands run in Discord's JS thread, so animate with the native driver or Reanimated worklets.
- Nothing from `react`, `react-native` or `@valenced/discord/*` may run when your script is evaluated (see `js/lazy.ts`).

## Test island

Any message containing `[island test]` gets the built-in test island (`js/demo.tsx`): width, on-screen state, a sideways-scrolling row and a counter that survives scrolling.
