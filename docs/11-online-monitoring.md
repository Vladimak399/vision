# 11. Онлайн-мониторинг

Не входит в Release 1. Будущий модуль использует Playwright-адаптер на каждого конкурента: discovery, fetch, parse, normalize, match, persist. Адаптер возвращает единый контракт: competitor SKU, URL, title, brand, size, regular/promo price, availability, observedAt.

Парсеры работают только в разрешенных пределах сайта, соблюдают rate limit, robots/условия использования и не обходят защиту. Селекторы версионируются; fixture-тесты обнаруживают изменение разметки.

Запуск идемпотентен по competitor/store/date. Ошибка одной страницы не отменяет batch. Цена попадает в общую history с source `online`, URL и timestamp вместо photo evidence. Dashboard различает `photo` и `online`.
