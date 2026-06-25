/**
 * Стадия 5 — Производство картинок карт. Два слота: 'stock' (сырое фото с Pexels) и
 * 'final' (итоговая картинка). Действия (action):
 *
 *  - 'stock'         — Pexels-поиск по card.stockQuery → слот stock.
 *  - 'stock-as-final'— копия уже найденного стокового фото → слот final (как есть).
 *  - 'stylize'       — img2img: сохранённое стоковое фото + imagePrompt → слот final.
 *  - 'generate'      — FLUX text2img по imagePrompt → слот final (без стока).
 *
 * Стилизация берёт байты из слота stock (readImage), а не ищет заново — это и есть
 * пользовательская схема «сначала сток, потом из него делается нужное».
 *
 * Стадия отдаёт байты + слот + мета; запись на диск/в БД делает вызывающий (index.ts),
 * как и у других стадий.
 */

import { generateImage, searchStock, stylize } from '../media.js';
import { readImage } from '../imagestore.js';
import type { Card } from '../types.js';
import type { ProgressFn } from '../jobs.js';
import { mapWithLimit, genConcurrency } from './generator.js';

export type ImageAction = 'stock' | 'stock-as-final' | 'stylize' | 'generate';

export interface ImageOutput {
  slot: 'stock' | 'final';
  bytes: Buffer;
  ext: string;
  stockMeta?: NonNullable<Card['stockMeta']>;
  imageMeta?: NonNullable<Card['imageMeta']>;
}

/** Стоковый запрос карты: явный stockQuery, иначе фолбэк на имя карты. */
export function stockQueryOf(card: Card): string {
  return (card.stockQuery?.trim() || card.name).trim();
}

/** Производит картинку одной карты по выбранному действию. */
export async function produceCardImage(card: Card, action: ImageAction): Promise<ImageOutput> {
  const at = Date.now();
  const prompt = card.imagePrompt?.trim();

  if (action === 'generate') {
    if (!prompt) throw new Error('у карты нет промпта изображения — сначала Стадия 4');
    const img = await generateImage(prompt);
    return { slot: 'final', bytes: img.bytes, ext: img.ext, imageMeta: { kind: 'generate', ext: img.ext, at } };
  }

  if (action === 'stock') {
    const photo = await searchStock(stockQueryOf(card));
    return {
      slot: 'stock',
      bytes: photo.bytes,
      ext: photo.ext,
      stockMeta: { kind: 'stock', ext: photo.ext, credit: photo.credit, pageUrl: photo.pageUrl, at },
    };
  }

  // Действия из стока требуют уже найденного стокового фото.
  if (!card.stockMeta) throw new Error('нет стокового фото — сначала «Найти сток»');
  const stockBytes = readImage(card.id, 'stock', card.stockMeta.ext);
  if (!stockBytes) throw new Error('файл стокового фото не найден — найдите сток заново');

  if (action === 'stock-as-final') {
    return {
      slot: 'final',
      bytes: stockBytes,
      ext: card.stockMeta.ext,
      imageMeta: {
        kind: 'stock',
        ext: card.stockMeta.ext,
        credit: card.stockMeta.credit,
        pageUrl: card.stockMeta.pageUrl,
        at,
      },
    };
  }

  // action === 'stylize'
  if (!prompt) throw new Error('у карты нет промпта изображения — сначала Стадия 4');
  const styled = await stylize(stockBytes, prompt);
  return {
    slot: 'final',
    bytes: styled.bytes,
    ext: styled.ext,
    imageMeta: {
      kind: 'stylize',
      ext: styled.ext,
      credit: card.stockMeta.credit,
      pageUrl: card.stockMeta.pageUrl,
      at,
    },
  };
}

export interface BatchImageResult {
  cardId: number;
  output?: ImageOutput;
  error?: string;
}

/**
 * Пакетное производство по действию. Цель отбора зависит от действия:
 *  - 'stock'    — карты со стоковым запросом или именем (есть что искать);
 *  - остальные  — карты с промптом изображения; действия из стока ещё требуют stockMeta.
 * Возвращает результаты по каждой карте (output или error). Запись — на стороне вызывающего.
 */
export async function runImageBatch(
  cards: Card[],
  action: ImageAction,
  opts: { onProgress?: ProgressFn } = {}
): Promise<BatchImageResult[]> {
  const targets = cards.filter((c) => {
    if (!c.name?.trim()) return false;
    if (action === 'stock') return true; // запрос есть всегда (фолбэк — имя)
    if (action === 'generate' || action === 'stylize') return !!c.imagePrompt?.trim();
    return true; // stock-as-final
  });
  // Картинки тяжелее текста (10–30 c) — параллелим умеренно, не больше 2.
  const concurrency = Math.min(2, genConcurrency());
  const results: BatchImageResult[] = [];
  let done = 0;
  opts.onProgress?.(0, targets.length, `Производство картинок: 0/${targets.length}`);
  await mapWithLimit(targets, concurrency, async (card) => {
    try {
      const output = await produceCardImage(card, action);
      results.push({ cardId: card.id, output });
    } catch (e) {
      results.push({ cardId: card.id, error: e instanceof Error ? e.message : String(e) });
    }
    done += 1;
    opts.onProgress?.(done, targets.length, `Производство картинок: ${done}/${targets.length}`);
  });
  return results;
}
