# 13. Фото-доказательства

Evidence связывает confirmed price с original photo, bbox/crop metadata, session, item и actor decision. Оригиналы находятся в private bucket; приложение выдает signed URL на 10 минут после проверки membership.

Файлы удаляются через 90 дней от `captured_at` или upload time, если дата неизвестна. Ежедневная retention job сначала помечает `expires_at`, затем удаляет object и переводит photo в `expired`. Price history, match и audit сохраняются; UI явно показывает, что фото истекло.

Admin может удалить фото раньше с причиной и audit event. Экспорт не продлевает retention. Checksum, MIME, dimensions и Storage path записываются при upload; замена оригинала запрещена.
