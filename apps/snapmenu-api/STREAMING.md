# Streamed menu scans

`POST /api/menu` is unchanged by default: same request, one JSON body, same `MenuResult`.
Add `"stream": true` to the request body and the same scan arrives as server-sent events,
dish by dish, so the app can show dishes about 3 s after upload instead of after 20 s.

## What the web app must change (only to use the stream)

Nothing, if it keeps the plain request. To stream, in `apps/snapmenu-web/src/lib/api.ts`:

1. Send `stream: true` in the JSON body.
2. Branch on the response `content-type`:
   - `application/json`: the old behaviour (also every error known before the model
     answers: `bad_json`, `bad_profile`, `no_image`, `too_big`, with their HTTP status;
     and every scan when the server runs with `SCAN_STREAM=off`). Parse as today.
   - `text/event-stream`: read `res.body`, split on a blank line (`\n\n`), drop the
     leading `data: `, `JSON.parse` the rest. HTTP status is 200; a failure is an `error` event.

```ts
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
let buf = ''
for (;;) {
  const { value, done } = await reader.read()
  if (done) break
  buf += value
  for (let end; (end = buf.indexOf('\n\n')) >= 0; buf = buf.slice(end + 2)) {
    onEvent(JSON.parse(buf.slice(6, end)) as ScanEvent) // type ScanEvent is exported by src/index.ts
  }
}
```

## Events, in order

| `type`   | Payload | When | Use it for |
|----------|---------|------|------------|
| `start`  | `scanId` | at once | switch from "uploading" to "reading" |
| `menu`   | `restaurant`, `menuLanguage`, `cuisine` | before the first dish | header |
| `dish`   | `index`, `dish` (a full `DishEstimate`: ranges, rows, sources, allergens, `score`, `why`) | once per dish, as the model writes it | show the dish; order by `index` (menu order) or by `score` |
| `result` | `result` (the full `MenuResult`, with `tips: []`) | when every dish is in | replace the preview with the ranked menu: `top`, `avoid`, all dishes |
| `tips`   | `tips`: per picked dish `local` (the sentence for the waiter, in the menu's language, with its language code `lang`), `translated` (what it means, in the user's language; empty when the menu is in that language) and `why` | about 2 to 4 s after `result` | fill in "say this to the waiter"; show `why` in place of the dish's own line |
| `done`   | `timings` | last | stop the spinner |
| `error`  | `status`, `error: { code, message }` | instead of the rest | same codes and messages as the JSON errors (`not_menu` 422, `refusal`, `rate_limited` ...) |

Rules for the client:

- `dish` events are a preview. `result` is the answer: build the result screen from it.
  Every `dish` event equals `result.dishes[index]` (tested), so nothing jumps.
- `dish` events can arrive slightly out of `index` order.
- `result.tips` is always empty; the tips come in the `tips` event (an empty list if the tip call failed).
- A tip's `why` is the voice model's sentence for a picked dish. `dishes[].why` is the engine's fixed
  sentence in the user's language: it is there for every dish from the first `dish` event and never changes.
- A dropped connection before `result` is a failed scan; after `result` only the tips are missing.

## Cost

A streamed scan costs about twice the Worker CPU of a plain one (every chunk of the
model's answer wakes the Worker): 19.9 ms against 10.7 ms for a warm 24-dish scan in
`scripts/cpu-scan.mjs`, a little under what a scan cost before this change (22.9 ms). If the
free plan's CPU limit bites under load, set the Worker variable `SCAN_STREAM=off`: every
scan is then answered as plain JSON, with no change to the app (rule 2 above).

## Measuring

```sh
node scripts/cpu-scan.mjs            # CPU per scan, plain; add --stream for the stream
node scripts/mock-anthropic.mjs 8804 250 &   # the AI service, paced; no key, no cost
npx wrangler dev --local --port 8803 --inspector-port 9233 --var ANTHROPIC_BASE_URL:http://127.0.0.1:8804 &
node scripts/bench-scan.mjs --stream --runs 1   # time to first dish, to the ranked menu
```

Which model does which job is a setting (`MODEL_READ`, `MODEL_VOICE` in `wrangler.toml`, see `src/models.ts`).
To see what a setting costs in seconds:

```sh
npm run bench:latency -w @snapmenu/api             # one model against another on the test menus: prints the plan and its price
npm run bench:latency -w @snapmenu/api -- --paid   # runs it on the real AI service (costs money); --mock tries the script for free
```

Every real scan also logs its seconds and the models that answered it: `GET /api/numbers` shows the
median per model under `scanSeconds`, at no extra cost.
