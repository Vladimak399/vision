# 12. Excel-экспорт

ExcelJS формирует отчет только из snapshot завершенной сессии. Листы: `Summary`, `Prices`, `Review Log`, `Errors`. Основные колонки: SKU, товар, бренд, размер, наша цена, конкурент, магазин, цена конкурента, promo, разница ₽/%, дата, confidence, decision, evidence link.

Деньги экспортируются числами с форматом, даты — датами, заголовок закреплен, включены filter и widths. Формулы используют snapshot-значения и защищены от formula injection: пользовательский текст с `= + - @` экранируется.

Evidence link ведет на приложение, которое после авторизации создает signed URL; прямой Storage URL не записывается. Имя файла: `pricevision_{competitor}_{store}_{YYYY-MM-DD}_{sessionId}.xlsx`. Report содержит checksum и schema version.
