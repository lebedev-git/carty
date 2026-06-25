/**
 * Файловое хранилище картинок карт (Стадия 5).
 * У карты два слота: 'stock' (сырое фото с Pexels) и 'final' (итоговая картинка).
 * Байты лежат на диске в server/data/images/<cardId>-<slot>.<ext>, а в БД — только мета
 * (db.cards.stock_meta / image_meta). Так БД остаётся лёгкой, а файлы отдаются напрямую.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = join(__dirname, '..', 'data', 'images');

export type ImageSlot = 'stock' | 'final';

function ensureDir(): void {
  if (!existsSync(IMAGES_DIR)) mkdirSync(IMAGES_DIR, { recursive: true });
}

/** Сохраняет байты картинки карты в слот, заменяя прежний файл (любого расширения). */
export function saveImage(cardId: number, slot: ImageSlot, bytes: Buffer, ext: string): void {
  ensureDir();
  removeImage(cardId, slot); // убираем прежнюю версию (могло смениться расширение)
  writeFileSync(join(IMAGES_DIR, `${cardId}-${slot}.${ext}`), bytes);
}

/** Возвращает байты картинки карты из слота (или null, если файла нет). */
export function readImage(cardId: number, slot: ImageSlot, ext: string): Buffer | null {
  const p = join(IMAGES_DIR, `${cardId}-${slot}.${ext}`);
  return existsSync(p) ? readFileSync(p) : null;
}

/** Удаляет файл(ы) слота картинки карты (любое расширение). */
export function removeImage(cardId: number, slot: ImageSlot): void {
  if (!existsSync(IMAGES_DIR)) return;
  const prefix = `${cardId}-${slot}.`;
  for (const f of readdirSync(IMAGES_DIR)) {
    if (f.startsWith(prefix)) {
      try {
        unlinkSync(join(IMAGES_DIR, f));
      } catch {
        /* файл уже удалён — игнорируем */
      }
    }
  }
}
