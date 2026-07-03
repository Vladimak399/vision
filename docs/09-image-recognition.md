# 09. Распознавание изображений

Pipeline: проверка MIME/magic bytes/≤20 MB → SHA-256 → private Storage → нормализованная AI-копия → structured output → validation bbox/price → recognized items/evidence → matching.

Полка может содержать несколько товаров и ценников; связь создается только при визуальной близости. Нечитаемая цена не создается. Promo и regular price хранятся раздельно; MVP экспортирует выбранную цену с promo flag.

Recognition confidence отражает качество чтения, не вероятность match. Дубликаты между фото разрешаются на уровне сессии по product, price и proximity/time metadata.
