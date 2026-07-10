# PV-22 — Full Project Audit and Implementation Roadmap

Status: documentation-only audit. No production code changes, no Vercel deploy, no Supabase writes, no secrets.

## Executive conclusion

The project already contains more production-relevant PriceVision functionality than the recent local OCR work assumed. The correct MVP path is not to make RapidOCR the primary engine. The correct MVP path is:

1. Use the existing AI shelf-recognition flow as the primary recognition engine.
2. Use Gemini as the default/free primary provider.
3. Use OpenRouter as paid/low-cost fallback when Gemini quota/rate limits block the run.
4. Preserve full AI evidence fields and route uncertain rows to review.
5. Use the existing monitoring/catalog/matching/export modules rather than building a second disconnected pipeline.
6. Treat the local RapidOCR/detector path as an optional cost-optimization/fallback path, not the MVP blocker.
7. Continue online competitor monitoring as a separate source type using the existing online-monitoring subsystem.

## What was missed earlier

### 1. Existing AI shelf recognition engine

The repository already has `server/shelf-recognition/*`:

- `index.ts` — provider entrypoint and fallback orchestration.
- `types.ts` — structured recognition contract.
- `prompt.ts` — shelf-photo extraction prompt.
- `gemini.ts` — Gemini vision provider.
- `openrouter.ts` — OpenRouter vision provider.
- `openai.ts` — OpenAI vision provider, currently not usable for this user because there is no OpenAI key.
- `normalize.ts` — robust normalizer for provider JSON.

This flow already returns the fields PriceVision needs: product text, price, old/promo price, price tag text, visible package text, confidence, link confidence, review flags, and position hints.

### 2. Existing AI queue/worker flow

The repository already has `server/worker/queue-processor.ts` and `server/worker/index.ts`. These process `photo_ocr` jobs, call `recognizeShelfPhoto`, insert `recognized_items`, create evidence records, and attempt catalog matching.

This means the missing work is not “invent AI recognition”. The missing work is to harden and correctly wire the existing AI recognition flow.

### 3. Existing online competitor monitoring

The repository already has `server/online-monitoring/*`, including adapters for:

- `x5_5ka` — Пятёрочка / 5ka.
- `spar_online` — SPAR Online.
- `metro_online` — METRO Online.
- `magnit` — already present as a fourth candidate.

It also has run management, registry, UI pages, API routes, cron route, source detection, matching, normalize, alerts, and tests. This is not just an idea; it is an unfinished subsystem that should be continued.

### 4. Existing monitoring/review/export UI

The repository already has monitoring session pages, review pages, manual match actions, recognized item review actions, and Excel export routes for monitoring sessions. These should be part of the MVP path.

### 5. The new `server/price-capture/*` local OCR path is useful but not primary

The local detector/RapidOCR path adds evidence discipline, crop diagnostics, price parser, product text extraction, and dry-run persistence. However, real photo tests showed OCR text count = 0 on the sample photos. This path should not block MVP. It remains valuable for later cost reduction and evidence enrichment.

## Current constraints

- No OpenAI key.
- Gemini key exists/free tier is available but daily/rate limits apply.
- OpenRouter key exists and can be used for paid or low-cost fallback models.
- PriceVision must avoid silent wrong matches.
- The business goal is a usable monitoring tool, not a perfect CV research pipeline.

## Critical defects and risks

### P0 — Must fix before MVP use

#### P0.1 Worker matching uses random scores

`server/worker/index.ts` currently uses placeholder matching logic with `Math.random()` to score candidate catalog matches. This can create nondeterministic and wrong matches. It must be replaced with the existing deterministic catalog matching logic.

Required fix:

- Use `server/auto-catalog-matching.ts`, `server/text-ai/catalog-match.ts`, `server/text-ai/catalog-match-batch.ts`, or the local product matcher as the canonical matching engine.
- Never auto-match with random score.
- If confidence is below threshold, leave row unmatched and send to review.

#### P0.2 Worker discards important AI recognition fields

`saveRecognizedItem` currently saves only a subset of the AI response. The AI result includes old/promo price, price tag text, product visible text, link confidence, review flags, review reason, and position hint, but the worker persistence path does not preserve all of it.

Required fix:

- Persist or map all AI evidence fields.
- At minimum preserve: `price_tag_text`, `product_visible_text`, `old_price_minor`, `promo_price_minor`, `link_confidence`, `needs_review`, `review_reason`, `position_hint`.
- If current DB tables do not support these fields, either add additive columns or persist them in evidence metadata.

#### P0.3 AI worker may send a storage path instead of a readable image URL

The worker passes `job.payload.storage_path` as `imageUrl` to `recognizeShelfPhoto`. If this value is only a Supabase storage path and not a public/signed URL, Gemini/OpenRouter/OpenAI cannot read the image.

Required fix:

- Resolve photo storage path into either:
  - signed URL, or
  - base64 + MIME type.
- Prefer base64 for private/local controlled processing to avoid URL accessibility issues.
- Add a test proving a queued photo job sends a provider-readable image input.

#### P0.4 There are two competing data flows

The project now has:

- older monitoring flow: `monitoring_sessions`, `monitoring_photos`, `recognized_items`, `evidence`, `matches`;
- newer price-capture flow: `price_capture_runs`, `competitor_shelf_items`, crop/evidence persistence.

Required decision:

- MVP should use the older monitoring flow because it already has UI, review, exports, queue, and AI recognition.
- The newer price-capture evidence tables should be used later as a refined evidence layer or integrated deliberately, not in parallel without a bridge.

### P1 — Fix shortly after MVP path is restored

#### P1.1 Gemini fallback configuration does not fully fit the user’s constraints

Defaults are Gemini primary and Gemini fallback. For this user, fallback should be OpenRouter because Gemini has a daily/rate limit.

Recommended env strategy:

```bash
AI_VISION_PROVIDER=gemini
AI_VISION_MODEL=gemini-2.5-flash-lite
AI_FALLBACK_PROVIDER=openrouter
AI_FALLBACK_MODEL=<chosen-openrouter-vision-model>
GEMINI_API_KEY=<set locally/server-side>
OPENROUTER_API_KEY=<set locally/server-side>
AI_RUN_BUDGET_USD=0.50
```

#### P1.2 Fallback model is not propagated cleanly

The fallback attempt stores only provider, not provider + model. The OpenRouter provider uses the fallback model only indirectly and may fall back to its own default. The fallback chain should carry both provider and model.

Required fix:

- Change fallback attempt shape to `{ provider, model }`.
- Provider functions should accept an explicit model override.
- Add tests for Gemini primary → OpenRouter fallback model selection.

#### P1.3 OpenRouter cost is hardcoded as free

`openrouter.ts` currently sets estimated cost to zero. That is only valid for actually free models. With a low-cost paid model, this becomes incorrect and breaks budget control.

Required fix:

- Add model pricing map or configurable pricing.
- At minimum return `null` instead of `0` when model is not known-free.
- Keep `AI_RUN_BUDGET_USD` enforcement meaningful.

#### P1.4 `price-capture` evidence contract cannot represent AI-used rows

`CompetitorShelfItemEvidenceRow` currently types `ai_used: false`. That prevents clean reuse for AI shelf recognition results.

Required fix:

- Either add separate AI evidence builder, or extend the contract to support AI provider/model/confidence fields.
- Do not force AI rows through detector/crop fields unless bbox/crop is genuinely available.

#### P1.5 SPAR adapter is incomplete

`server/online-monitoring/adapters/spar-online.ts` still has TODOs for JSON structure, pagination, brand/size/barcode extraction, and Playwright fallback. There is also a suspicious mixed-script category slug: `khimия`.

Required fix:

- Verify real SPAR endpoints/selectors.
- Replace hardcoded category slugs with configured sources/categories.
- Add fixture tests for actual saved HTML/JSON.
- Fix the mixed Cyrillic/Latin slug bug.

#### P1.6 5ka and METRO adapters need live validation and legal gating

The adapters exist, but they depend on current website/API behavior, store/city context, cookies, internal JSON shape, and allowed scraping policy.

Required fix:

- Add per-source legal/status gate before any run.
- Add dry-run source validation command.
- Save fixture responses and test parser against fixtures.
- Store `sourceStoreId` / city mapping explicitly.

### P2 — Cleanup / quality issues

#### P2.1 Local OCR path failed real-photo OCR

RapidOCR returned zero text on real shelf photos. Keep it as fallback and benchmarking, not MVP blocker.

#### P2.2 Local test suite has environment fragility

User reported many local failures caused by `spawn npx ENOENT`. This looks like Windows/local-shell test fragility, not necessarily product logic.

Required fix:

- Prefer local `node_modules/.bin` / `process.execPath` where practical.
- Add Windows-friendly test command documentation.
- Do not mix this with business-flow fixes.

#### P2.3 Security advisor warnings remain

Supabase warnings around search_path, security definer functions, and leaked password protection still exist. They are not MVP blockers but should be scheduled.

## Target architecture

### Source type A — Store shelf photos

Primary recognition path:

```text
photo upload
→ monitoring photo/job
→ existing shelf-recognition AI provider
→ normalized recognition items
→ deterministic catalog matching
→ review queue for uncertain rows
→ Excel export
```

Provider policy:

1. Gemini first while free daily quota is available.
2. OpenRouter fallback when Gemini quota/rate limit is hit.
3. No OpenAI dependency in the default user setup.
4. Local OCR only as optional fallback/benchmark/cost-reduction experiment.

### Source type B — Online competitor catalogs

Primary parsing path:

```text
online source config
→ source run
→ source adapter: 5ka / SPAR / METRO
→ online product observations
→ normalization
→ catalog matching
→ alerts / unmatched review / export
```

Online source priorities:

1. 5ka first, because it already has an API-oriented adapter.
2. METRO second, because it has structured `__NEXT_DATA__` parsing logic.
3. SPAR third, because current adapter is more placeholder/HTML-regex based and needs verification.

## Implementation roadmap

### PV-23 — Restore AI shelf recognition as MVP engine

Goal: make the already existing AI recognition path the official PriceVision MVP path.

Tasks:

- Add a debug script that runs `recognizeShelfPhoto` on local images using Gemini/OpenRouter.
- Add provider-readable image input handling: base64 or signed URL.
- Add output summary: items count, prices count, names count, needs_review count, usage, provider/model.
- Do not use RapidOCR in this path.

Acceptance:

- Real shelf photo returns structured JSON or clear provider error.
- Gemini quota errors are visible and actionable.
- OpenRouter fallback can be manually tested.

### PV-24 — Fix worker persistence and evidence loss

Goal: no AI output fields are silently lost.

Tasks:

- Persist AI fields or evidence metadata.
- Preserve old/promo price, price tag text, product visible text, link confidence, review flags, review reason, position hint.
- Add tests around `saveRecognizedItem`/evidence persistence.

Acceptance:

- A recognition item returned by AI can be round-tripped into DB shape without losing critical review/evidence fields.

### PV-25 — Replace random matching

Goal: deterministic and review-safe matching.

Tasks:

- Remove `Math.random()` scoring from worker matching.
- Reuse existing catalog matching logic.
- Add thresholds:
  - high confidence → auto-match;
  - medium/low confidence → needs review;
  - no candidate → unmatched.

Acceptance:

- Same input produces same match.
- Low-confidence rows are not silently auto-matched.

### PV-26 — Provider fallback and cost control

Goal: match user’s key setup: Gemini free primary, OpenRouter fallback.

Tasks:

- Fallback attempt carries `{ provider, model }`.
- OpenRouter uses `AI_FALLBACK_MODEL` when it is the fallback provider.
- Estimated cost is not hardcoded to zero for paid models.
- Add budget guard using `AI_RUN_BUDGET_USD`.

Acceptance:

- Gemini 429 can fall back to OpenRouter.
- Model used is visible in result usage.
- Cost is tracked as known value or `null`, not false zero.

### PV-27 — Online monitoring validation harness

Goal: validate 5ka, METRO, SPAR without production writes.

Tasks:

- Add dry-run CLI for each adapter.
- Add fixture capture format.
- Add parser health output: fetched count, price count, missing title count, availability count.
- Enforce legal/status gate before live fetch.

Acceptance:

- `5ka`, `metro`, and `spar` can be tested independently.
- Failures are source-specific and do not break the rest of the app.

### PV-28 — Online monitoring MVP for 5ka

Goal: first useful web competitor source.

Tasks:

- Validate real 5ka endpoint/store ID for Kaliningrad.
- Configure source store/city mapping.
- Normalize observations into `online_product_observations`.
- Match to internal catalog.
- Surface unmatched products.

Acceptance:

- One source run creates normalized observations and unmatched/matched statistics.

### PV-29 — METRO MVP

Goal: second web competitor source.

Tasks:

- Validate current METRO page/API structure.
- Decide online_delivery vs store_visit strategy.
- Add fixtures and parser tests.

### PV-30 — SPAR MVP

Goal: third web competitor source.

Tasks:

- Fix SPAR category slugs.
- Replace placeholder parsing with verified parser or browser worker.
- Add pagination.
- Add fixtures and tests.

### PV-31 — Unified reporting

Goal: one export flow for photo monitoring + online monitoring.

Tasks:

- Export recognized photo rows.
- Export web competitor observations.
- Include match status and review flags.
- Preserve evidence links and position/source URL.

## Immediate next action

Do not continue local RapidOCR work as the main track.

Next PR should be PV-23:

```text
AI shelf-recognition debug + base64/signed-url input validation
```

This restores the previously working idea and tests it against the user’s current keys: Gemini + OpenRouter, no OpenAI.
