# AI model configuration

Use environment variables to switch providers and models without code changes.

## Vision / shelf photo OCR

Shelf photo OCR currently supports OpenAI only.

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

Recommended cheap first setup:

```env
AI_VISION_PROVIDER=openai
AI_VISION_MODEL=gpt-5.4-mini
```

Use a stronger model only when photo quality is poor or recognition quality is not acceptable.

## Text AI / catalog matching and reports

Text tasks should be cheap by default.

```env
AI_TEXT_PROVIDER=deepseek
AI_TEXT_MODEL=deepseek-chat
DEEPSEEK_API_KEY=...
```

Use text AI for:

- product name normalization;
- difficult catalog matching;
- grouping competitor-only assortment;
- report comments and summaries.

Do not use text AI for simple price difference calculation, SQL filters, or deterministic Excel columns.

## Fallback

Fallback is for rare difficult cases.

```env
AI_FALLBACK_PROVIDER=openai
AI_FALLBACK_MODEL=gpt-5.4-nano
```

## Budget guard

```env
AI_RUN_BUDGET_USD=1
```

This variable is reserved for job-level budget limits. The target is to keep ordinary website price runs below one dollar by using parsers and local matching first, then AI only for disputed rows.

## Practical setup for this project

```env
AI_VISION_PROVIDER=openai
AI_VISION_MODEL=gpt-5.4-mini
AI_TEXT_PROVIDER=deepseek
AI_TEXT_MODEL=deepseek-chat
AI_FALLBACK_PROVIDER=openai
AI_FALLBACK_MODEL=gpt-5.4-nano
AI_RUN_BUDGET_USD=1
OPENAI_API_KEY=...
DEEPSEEK_API_KEY=...
```
