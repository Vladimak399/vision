# 05. UI/UX

Минималистичный desktop-first интерфейс: строгая сетка, ясная иерархия, один основной action, без декоративного шума. Навигация: Dashboard, Мониторинги, Ассортимент, История, Отчеты, Настройки.

## Экраны

- Dashboard: магазины, позиции, auto/review, точность, последние сессии.
- Catalog: импорт, ошибки строк, поиск и собственная цена.
- New monitoring: конкурент, магазин, дата, drag-and-drop до 500 фото.
- Session: прогресс, ошибки и счетчики статусов.
- Review: crop слева, AI-данные и candidates справа, keyboard workflow.
- History: товар, конкурент, временной ряд и evidence.
- Export: состав snapshot и создание Excel.

Каждый экран имеет `loading`, `empty`, `partial`, `error`, `forbidden`, `ready`. Прогресс показывает реальные счетчики. WCAG 2.2 AA: focus, keyboard, labels, aria-live, контраст ≥4.5:1. Анимации 120–200 мс и поддерживают reduced motion.
