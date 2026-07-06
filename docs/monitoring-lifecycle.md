# Monitoring lifecycle

This document describes the current monitoring session lifecycle before AI/OCR is implemented.

## Existing session statuses

The database already supports these `session_status` values:

- `draft`
- `uploading`
- `processing`
- `review`
- `completed`
- `failed`
- `cancelled`

## Current app transitions

### Create session

New monitoring sessions are created with:

```text
status = draft
started_at = null
completed_at = null
```

### Upload photos

When the first photo upload is accepted for a `draft` session, the app updates the session to:

```text
status = uploading
started_at = now, if it was empty
```

Photos are still inserted with:

```text
status = uploaded
```

This means the session has moved out of an empty draft state and has real uploaded evidence, but AI/OCR is not running yet.

### Manual recognized item fallback

When a manual fallback item is added and the session is in `draft`, `uploading`, or `processing`, the app updates the session to:

```text
status = review
started_at = now, if it was empty
```

The manual item is inserted with:

```text
status = needs_review
```

### Locked terminal states

The app blocks photo uploads and manual recognized item creation for:

- `completed`
- `cancelled`

## Not implemented yet

- AI/OCR worker queue
- automatic transition from `uploading` to `processing`
- automatic transition from `processing` to `review`
- completed/failed/cancelled UI actions
- retry lifecycle
- per-photo queued/processing transitions from a worker

## Required before AI/OCR

Before adding the OCR provider call, add a worker/job boundary that owns these transitions:

```text
uploaded photo -> queued job -> processing -> processed/failed
session uploading -> processing -> review/failed
```

Do not run OCR directly inside user-facing Server Actions.
