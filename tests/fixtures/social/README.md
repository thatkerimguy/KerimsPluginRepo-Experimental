# Social Embeds resolver fixtures

API responses the resolver tests parse.

**The current files are hand-made**, written in the documented shapes of FxEmbed's API (`api.fxtwitter.com`) and Reddit's listing JSON, because the cloud environment they were written in can't reach those sites. Replace them with real recordings as soon as possible, from a machine with normal internet access:

```
node tests/fixtures/social/record.mjs
```

The script fetches the posts listed in it and writes `<name>.recorded.json` files next to these. Check them, rename them over the hand-made ones (or add new cases), then run `npm test` in `tests/` and fix whatever the real data breaks. Keep the posts in `record.mjs` public, long-lived and harmless.
