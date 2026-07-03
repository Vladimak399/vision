# 16. Безопасность

Supabase Auth управляет сессиями; доступ определяется membership и ролями `admin | manager | reviewer`. RLS включен на всех tenant-таблицах. `company_id` не принимается как доверенный browser input. Service role и OpenAI key доступны только server/worker.

Uploads используют short-lived signed URLs, allowlist MIME, magic-byte validation, лимиты размера/количества и случайные object paths. Buckets private. Evidence/download endpoints повторно проверяют membership. Rate limits действуют на sign, process, review и export.

Audit хранит actor, action, entity, before/after metadata, request ID и timestamp без токенов/изображений. Secrets находятся в environment manager, ротируются и не логируются. Retention удаляет фото через 90 дней. Backup/restore тестируется ежеквартально.

Threat model покрывает tenant escape, IDOR, formula injection, malicious files, prompt injection с ценника, replay jobs и утечку signed URL. AI-текст считается недоверенным и никогда не выполняется.
