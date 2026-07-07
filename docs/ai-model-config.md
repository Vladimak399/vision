# AI model configuration

Use environment variables to switch providers and models without code changes.

## Current cheap setup

The project can run text AI and shelf-photo OCR with only a Gemini API key.

```env
GEMINI_API_KEY=...
AI_TEXT_PROVIDER=gemini
AI_TEXT_MODEL=gemini-2.5-flash-lite
AI_VISION_PROVIDER=gemini
AI_VISION_MODEL=gemini-2.5-flash-lite
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=gemini-2.5-flash
AI_RUN_BUDGET_USD=1
```

## Vision / shelf photo OCR

Shelf photo OCR supports Gemini and OpenAI.

Gemini setup:

```env
GEMINI_API_KEY=...
AI_VISION_PROVIDER=gemini
AI_VISION_MODEL=gemini-2.5-flash-lite
```

OpenAI setup:

```env
AI_VISION_PROVIDER=openai
AI_VISION_MODEL=gpt-5.4-mini
OPENAI_API_KEY=...
```

Fallback compatibility:

```env
OPENAI_OCR_MODEL=gpt-5.4-mini
```

`AI_VISION_MODEL` has priority over `OPENAI_OCR_MODEL`.

## Text AI / catalog matching and reports

Text tasks should be cheap by default.

Gemini setup:

```env
AI_TEXT_PROVIDER=gemini
AI_TEXT_MODEL=gemini-2.5-flash-lite
GEMINI_API_KEY=...
```

`AI_TEXT_BASE_URL` is optional for Gemini. If it is omitted, the text client uses the Gemini OpenAI-compatible endpoint:

```env
https://generativelanguage.googleapis.com/v1beta/openai/
```

Generic OpenAI-compatible setup:

```env
AI_TEXT_PROVIDER=deepseek
AI_TEXT_MODEL=deepseek-chat
AI_TEXT_BASE_URL=https://api.deepseek.com/
DEEPSEEK_API_KEY=...
```

Alternative generic key:

```env
AI_TEXT_API_KEY=...
```

`AI_TEXT_API_KEY` has priority for the text client. If it is missing, the client falls back to the provider-specific key.

Use text AI for:

- product name normalization;
- difficult catalog matching;
- grouping competitor-only assortment;
- report comments and summaries.

Do not use text AI for simple price difference calculation, SQL filters, or deterministic Excel columns.

## Fallback

Fallback is for rare difficult cases. With only Gemini configured, use Gemini fallback too.

```env
AI_FALLBACK_PROVIDER=gemini
AI_FALLBACK_MODEL=gemini-2.5-flash
```

## Budget guard

```env
AI_RUN_BUDGET_USD=1
```

This variable is reserved for job-level budget limits. The target is to keep ordinary website price runs below one dollar by using parsers and local matching first, then AI only for disputed rows.
