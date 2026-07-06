# OpenAI shelf recognition adapter

The adapter analyzes a full shelf photo, not only price tags.

It extracts product-price candidates using two signals:

1. Shelf price tag text for prices.
2. Visible package text near the price tag for brand, product name, type, and size.

The adapter does not match items to the internal catalog. Matching must stay in a later step.

## Core rules

- Price must come from a visible shelf price tag.
- Product name can use both price tag text and nearby package text.
- Package text is supporting evidence only.
- If the visual link between product and price tag is unclear, the item must be marked for review.
- Missing data must not be invented.

## Output

The adapter returns strict JSON with `items`, `warnings`, and usage metadata. Usage includes model, input tokens, output tokens, estimated cost, and duration.
