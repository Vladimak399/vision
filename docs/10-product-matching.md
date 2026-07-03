# 10. Сопоставление товаров

Normalization → exact alias → identifiers → retrieval → scoring → decision. Нормализация включает Unicode, регистр, пунктуацию, единицы, разделители и сокращения; исходная строка сохраняется.

Score: name 40%, brand 25%, size/unit 25%, category 10%. Brand conflict и несовместимый размер — hard penalties. Fuse.js формирует shortlist, RapidFuzz дает component scores.

Пороги: `≥0.92` и margin `≥0.08` → auto; `0.75–0.9199` или малый margin → review; `<0.75`/hard conflict → unmatched.

Только подтвержденный alias может дать будущий auto match. Correction усиливает alias, rejection снижает weight. Версии normalization/scoring записываются.
