# Sample test-service health endpoint

A minimal health endpoint your monitor can poll during a pilot. Any framework
works — the only contract is: **200 = up, non-200 (or timeout) = down.**

## Specification

- **Method / path:** `GET /health`
- **Up:** HTTP `200`, body `{"status":"ok"}`, within a short timeout (e.g. 5s).
- **Down:** any non-2xx status, a connection error, or a timeout.
- **Provider status page:** optionally expose `GET /status` returning a small JSON
  the provider controls (corroborating evidence), e.g. `{"operational":true}`.

## To simulate a controlled outage

- Toggle a flag/env var that makes `/health` return `503` for a measured window, **or**
- Stop the process / block the port for the window, **or**
- Point the monitor at a deliberately unavailable target.

Record the exact start and end so it matches your monitor report and the incident
window you dispute.

## Reference implementation (Node, zero-dependency)

```js
import { createServer } from 'node:http';
let up = true; // flip to false to simulate an outage
createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(up ? 200 : 503, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: up ? 'ok' : 'down' }));
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ operational: up }));
  }
  res.writeHead(404); res.end();
}).listen(8080, () => console.log('health server on :8080'));
```

Publish the monitor's summary of these checks as JSON (see
`monitor-report.schema.json`) at a public, commit-pinned HTTPS URL for the agreement.
