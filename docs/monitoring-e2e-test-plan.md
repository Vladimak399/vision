# E2E-план проверки мониторинга

## Ручной тест

1. Откройте `/app`.
2. Откройте `/app/ai-diagnostics`.
3. Подтвердите, что `GEMINI_API_KEY = Да`.
4. Запустите text AI smoke test.
5. Запустите vision AI smoke test с одним четким фото полки.
6. Откройте `/app/monitoring`.
7. Создайте или откройте тестовую сессию мониторинга.
8. Загрузите одно оригинальное фото с товарами отдела.
9. Проверьте, что количество фото увеличилось.
10. Поставьте загруженное фото в OCR-очередь.
11. Проверьте, что количество OCR jobs увеличилось.
12. Нажмите «Тест: 1 фото».
13. Проверьте, что появились `recognized_items`.
14. Откройте страницу review.
15. Проверьте кнопки статусов: OK, Нет, Проверить, Нет в ассортименте.
16. Проверьте ручной catalog match по SKU или части названия.
17. Проверьте «Подобрать кандидатов».
18. Проверьте export XLSX.
19. Проверьте detailed export по листам.
20. Если появились ошибки, проверьте Vercel runtime logs.

## Troubleshooting

| Симптом | Вероятная причина | Где проверить | Что делать |
|---|---|---|---|
| `GEMINI_API_KEY = Нет` | Переменная не задана в Vercel | `/app/ai-diagnostics`, Vercel Environment Variables | Добавить `GEMINI_API_KEY`, redeploy/restart runtime. |
| Text AI request failed | Неверная модель, провайдер или временная ошибка API | AI-диагностика, Vercel logs | Проверить `AI_TEXT_PROVIDER`, `AI_TEXT_MODEL`, ключ и повторить. |
| Gemini временно перегружен / 503 | Высокая нагрузка Gemini | AI-диагностика, OCR job error | Повторить позже или переключить модель в Vercel. |
| 429 лимит Gemini | Исчерпан лимит API | Vercel logs, Google AI quota | Подождать, уменьшить batch, проверить квоты. |
| Vision smoke test returns 0 items | Фото размытое, ценники не читаются, скриншот | AI-диагностика warnings | Загрузить оригинальное фото ближе к полке. |
| Photo upload says department missing | Для сессии/формы не выбран отдел | Страница сессии, departments | Выбрать или настроить отдел перед загрузкой. |
| Photo count does not increase | Upload не завершился или Storage/RLS ошибка | Страница сессии, Vercel logs, Supabase Storage | Проверить bucket `monitoring-photos` и права. |
| «Нет фото со статусом uploaded или failed» | Все фото уже queued/processing/processed | Диагностика сессии | Не ставить повторно, запустить обработку очереди. |
| OCR jobs stays 0 | Фото не поставлено в очередь или ошибка insert jobs | Диагностика сессии, jobs table | Нажать постановку в очередь, проверить RLS/policies. |
| OCR job failed | Ошибка Gemini, Storage download или payload | Диагностика сессии, Центр тестирования | Прочитать safe error, исправить причину и повторить. |
| Photo download failed | Файл не найден или нет доступа к Storage | Supabase Storage bucket `monitoring-photos` | Проверить путь, bucket и RLS/политики Storage. |
| `recognized_items` stays 0 after processed photo | Модель не распознала товары или все items без имени | Диагностика сессии, warnings/errors | Повторить с более четким фото; допустимо для плохих фото. |
| manual catalog match finds multiple items | Запрос слишком широкий | Review/manual match | Уточнить SKU, бренд, размер или часть названия. |
| item marked “Нет в ассортименте” appears again in auto matching | Auto-match не исключает status `unmatched` | Review, action logs | Проверить, что автоподбор берет только `recognized`/`needs_review`. |
| export XLSX fails | Ошибка данных, RLS или генерации XLSX | Export route, Vercel logs | Проверить доступ к сессии и данные recognized_items/matches. |
| detailed export has wrong “Не найдено” semantics | No-match трактуется как out-of-assortment | Detailed export | Помнить: только status `unmatched` означает «Нет в ассортименте». |

## Требования к качеству фото

- Оригинальное фото, не скриншот.
- Ценники читаются глазами.
- Товар и ценник в одном кадре.
- Без сильных бликов.
- Не слишком далеко от полки.
- Первый тест: 1–2 полки, не весь проход/стеллаж издалека.
- Не использовать фото, сжатые мессенджерами.

## Семантика данных

- Отсутствие match не означает «Нет в ассортименте».
- Только status `unmatched` означает «Нет в ассортименте».
- Товары без уверенного совпадения должны попадать в «На проверку».
- Export не должен автоматически помечать строки без match как «Нет в ассортименте».
