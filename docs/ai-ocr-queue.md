# AI/OCR queue boundary

This PR adds the queue boundary for future photo recognition. It does not call an OCR provider yet.

## User-facing flow

1. User uploads photos into a monitoring session.
2. User clicks the queue button on the session page.
3. Photos with status `uploaded` or `failed` move to `queued`.
4. The session moves to `processing`.
5. A `jobs` row is created per photo with `kind = photo_ocr`.

## Job payload

Each queued job stores:

```json
{
  "photo_id": "...",
  "storage_path": "...",
  "company_id": "...",
  "session_id": "..."
}
```

## Current status transitions

```text
monitoring_photos: uploaded/failed -> queued
monitoring_sessions: draft/uploading/review/failed -> processing
jobs: queued
```

## Future worker responsibility

The worker should own these transitions:

```text
job queued -> running -> succeeded/failed
photo queued -> processing -> processed/failed
session processing -> review/failed
```

The OCR provider call must not run inside user-facing Server Actions.
