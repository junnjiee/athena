# Frontend API handoff

Base URL: `https://athena-api-production-9b19.up.railway.app`

## 1. Submit simulations

Send `POST /v1/simulation-batches` as `multipart/form-data`:

- `payload`: JSON or gzip-compressed JSON file
- `simulationCount`: positive integer
- `ticks`: positive integer; defaults to `60`
- `model`: optional OpenRouter model ID

```ts
const form = new FormData()
form.append('payload', payloadFile)
form.append('simulationCount', String(simulationCount))
form.append('ticks', String(ticks))

const response = await fetch(`${ATHENA_API}/v1/simulation-batches`, {
  method: 'POST',
  body: form,
})
const { batchId, eventsUrl } = await response.json()
```

Do not set `Content-Type`; the browser adds the multipart boundary. A successful
submission returns HTTP `202`.

## 2. Receive results

```ts
const events = new EventSource(`${ATHENA_API}${eventsUrl}`)

events.addEventListener('simulation.completed', async ({ data }) => {
  const { simulationId, simulationIndex, replayUrl } = JSON.parse(data)
  const replay = await fetch(replayUrl).then((response) => response.json())
})

events.addEventListener('simulation.failed', ({ data }) => {
  const { simulationId, simulationIndex, error } = JSON.parse(data)
})

events.addEventListener('batch.completed', ({ data }) => {
  const { status, completed, failed } = JSON.parse(data)
  events.close()
})
```

`EventSource` reconnects automatically and the server replays missed events. Replay
URLs are private, temporary signed URLs.

## Browser prerequisites

Before integration, the deployed frontend origin must be added to the API's
`ALLOWED_ORIGINS` Railway variable and to the Railway Bucket CORS policy. There is
currently no API authentication, so do not expose this endpoint beyond the trusted
frontend until authentication is added. The OpenRouter key remains server-side.
