# PriceVision

Интеллектуальная платформа мониторинга розничных цен по фотографиям магазинов.

**Цель:** сократить ручную работу категорийного менеджера минимум на 90%, сохраняя фото-доказательство каждой цены.

## Release 1 — Photo MVP

Импорт ассортимента, мониторинг магазина, загрузка до 500 фотографий, AI-распознавание, сопоставление, review спорных позиций, Excel и базовая история цен. Онлайн-парсинг, уведомления, PDF/CSV и расширенная аналитика запланированы после MVP.

## Local development

npm install
npm run dev
npm run typecheck
npm run build

Environment variables are listed in `.env.example`.

## Deployment

Production deployment is handled by Vercel from the `main` branch.

## Документация

1. [Vision](docs/01-vision.md)
2. [PRD](docs/02-prd.md)
3. [Архитектура](docs/03-architecture.md)
4. [База данных](docs/04-database.md)
5. [UI/UX](docs/05-ui-ux.md)
6. [User flows](docs/06-user-flows.md)
7. [API](docs/07-api.md)
8. [AI-модуль](docs/08-ai-module.md)
9. [Распознавание изображений](docs/09-image-recognition.md)
10. [Сопоставление товаров](docs/10-product-matching.md)
11. [Онлайн-мониторинг](docs/11-online-monitoring.md)
12. [Excel-экспорт](docs/12-excel-export.md)
13. [Фото-доказательства](docs/13-evidence.md)
14. [История цен](docs/14-price-history.md)
15. [Развертывание](docs/15-deployment.md)
16. [Безопасность](docs/16-security.md)
17. [Тестирование](docs/17-testing.md)
18. [Roadmap](docs/18-roadmap.md)
19. [Backlog](docs/19-backlog.md)
20. [План релизов](docs/20-release-plan.md)

## Термины

- `catalog_product` — товар внутреннего ассортимента.
- `recognized_item` — позиция, извлеченная из фотографии.
- `match` — связь позиции с товаром ассортимента.
- `alias` — подтвержденное правило соответствия.
- `evidence` — фотография и координаты области, подтверждающие цену.
- `confidence` — нормализованная уверенность от `0` до `1`.

Документация написана на русском; идентификаторы, статусы и API-контракты — на английском.
