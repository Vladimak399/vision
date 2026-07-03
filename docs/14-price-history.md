# 14. История цен

`price_history` хранит catalog product, competitor, store, source, price minor, currency, promo, observedAt, session/item/evidence references. Запись создается только после confirmed decision; correction добавляет новую revision, не переписывает аудит.

Для одинаковых product/store/source/observedAt/price действует idempotency constraint. Текущая цена — последняя подтвержденная по observedAt. Изменение рассчитывается относительно предыдущей сопоставимой записи: amount и percent; деление на ноль возвращает null.

UI показывает временной ряд и таблицу. После истечения фото точка остается, но evidence помечается unavailable. Сравнение разных размеров запрещено, если matching не подтвердил эквивалентность единицы.
