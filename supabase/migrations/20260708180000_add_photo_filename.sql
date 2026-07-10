-- Добавление колонки photo_filename для хранения имени оригинального файла фото.
-- Это нужно для отображения оригинального имени файла в UI.

ALTER TABLE public.competitor_shelf_items ADD COLUMN IF NOT EXISTS photo_filename text;
