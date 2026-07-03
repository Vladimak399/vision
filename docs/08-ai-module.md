# 08. AI-модуль

OpenAI вызывается только recognition worker. Модель задается конфигурацией после eval; контракт отделен адаптером.

Structured output: `name`, `brand|null`, `variant|null`, `sizeValue|null`, `sizeUnit|null`, `priceMinor`, `currency`, `promo`, `bbox`, `recognitionConfidence`. Цена обязана быть видна на evidence.

Schema validation обязательна; один repair attempt допустим только для формата. Transient errors повторяются до трех раз. Prompt version, model, latency и cost пишутся без секретов. Смена модели требует precision не ниже текущей и известного cost per 100 photos.
