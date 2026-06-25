/**
 * Стадия 4 — Промпты изображений карт (методология «МАЯК / LIGHTHOUSE», раздел 10.6).
 *
 * Для каждой готовой карты собирается промпт изображения из 4 компонентов:
 *  - Фон 🔒 КОНСТАНТА: IMAGE_BG_CONSTANT (один на все карты).
 *  - Гамма 📌 ФИКСИРОВАНА по типу/лучу (palette из framework).
 *  - Центральный образ 🔄 ПЕРЕМЕННАЯ: фотореалистичный объект-метафора карты (LLM).
 *  - Настроение 🔄 фиксированное по типу/лучу (moodExample из framework).
 *
 * Итоговая структура:
 *  «{ФОН}, in shades of {ГАММА}. Centered, a photorealistic {ОБРАЗ}. {НАСТРОЕНИЕ}.»
 *
 * Образ запрашивается у модели батчами по категории (как Стадия 3) — 12 вызовов на колоду.
 * Промпт самих изображений НЕ генерирует картинку: это вход для медиа-продакшена
 * (Pexels-референс → Cloudflare img2img), который подключается отдельно по ключам.
 */

import { chatJSON } from '../llm.js';
import { CONTENT_TYPES, RAYS, IMAGE_BG_CONSTANT } from '../framework.js';
import type { Card } from '../types.js';
import type { ProgressFn } from '../jobs.js';
import { mapWithLimit, genConcurrency } from './generator.js';

export interface ImagePromptUpdate {
  cardId: number;
  imagePrompt: string;
  stockQuery: string;
}

/** Гамма и настроение карты — фиксированы по типу контента («Я») или лучу («МЫ»). */
function styleFor(card: Card): { palette: string; mood: string } {
  const list = card.axis === 'Я' ? CONTENT_TYPES : RAYS;
  const found = list.find((x) => x.title === card.category);
  return {
    palette: found?.palette ?? 'gray, blue and green',
    mood: found?.moodExample ?? 'Calm and focused',
  };
}

/** Убирает ведущий артикль из образа — в шаблоне артикль «a» уже есть. */
function stripArticle(s: string): string {
  return s.replace(/^\s*(a|an|the)\s+/i, '').trim();
}

/** Сборка финального промпта изображения из 4 компонентов. */
function assemble(palette: string, obraz: string, mood: string): string {
  return `${IMAGE_BG_CONSTANT}, in shades of ${palette}. Centered, a photorealistic ${stripArticle(
    obraz
  )}. ${mood}.`;
}

const SYSTEM = `You design visuals for educational card decks (system "МАЯК / LIGHTHOUSE").
For each card (title + situation) you return TWO things:

1. "subject" — ONE concrete photorealistic central object/scene that SYMBOLISES the card
   (a metaphor for an AI-generated illustration). 2–6 English words, a concrete noun phrase
   (e.g. "a cracked ceramic mug", "an hourglass with sand nearly gone").

2. "stockQuery" — a SEARCH QUERY for a real stock-photo library (Pexels). It must describe
   a REAL, common, photographable OBJECT or ENVIRONMENT that conveys the card's theme.
   3–6 English words, plain searchable terms. STRICT RULES:
   - NO people: never use person/teacher/student/child/man/woman/team/hands/portrait/crowd.
   - NO text/letters/numbers/signs/posters/screens-with-UI — nothing readable in frame.
   - Prefer objects, tools, workplaces, nature, still-life, empty interiors
     (e.g. card about teacher burnout → "empty classroom desk morning light";
      card about cyberbullying → "smartphone on dark wooden table";
      card about team planning → "empty meeting room table chairs";
      card about data → "abstract glowing network lines").

Rules for both: English only; the resulting image must contain NO people, NO text/letters/
numbers/logos; no brand names.
Return strictly one JSON object, no markdown.`;

function buildObrazPrompt(cards: Card[]): string {
  const items = cards.map((c, i) => `${i}: «${c.name}» — ${c.description}`).join('\n');
  return `Cards (give subject + stockQuery for each by its index):
${items}

Return strictly JSON:
{ "images": [ { "i": <index>, "subject": "<2-6 words metaphor object>", "stockQuery": "<3-6 words real photographable scene>" } ] }
Return exactly ${cards.length} items, one per index above.`;
}

interface ObrazItem {
  subject: string;
  stockQuery: string;
}
interface ObrazRes {
  images: { i: number; subject: string; stockQuery: string }[];
}

/** Запрашивает у модели образ-метафору и стоковый запрос для группы карт одной категории. */
async function obrazForGroup(cards: Card[]): Promise<Map<number, ObrazItem>> {
  const res = await chatJSON<ObrazRes>(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildObrazPrompt(cards) },
    ],
    {
      temperature: 0.7,
      retries: 2,
      validate: (v) => {
        const o = v as ObrazRes;
        if (!o || !Array.isArray(o.images)) throw new Error('нет images[]');
        for (const it of o.images) {
          if (typeof it?.i !== 'number' || !it?.subject || !it?.stockQuery)
            throw new Error('у образа нет i/subject/stockQuery');
        }
        return o;
      },
    }
  );
  const map = new Map<number, ObrazItem>();
  for (const it of res.images)
    if (typeof it.i === 'number')
      map.set(it.i, { subject: it.subject.trim(), stockQuery: it.stockQuery.trim() });
  return map;
}

/**
 * Генерирует промпты изображений для всех карт с контентом, группируя по категории.
 * Возвращает обновления для применения в БД; пустые карты пропускаются.
 */
export async function runImagePrompts(
  cards: Card[],
  opts: { onProgress?: ProgressFn } = {}
): Promise<ImagePromptUpdate[]> {
  // Только карты с названием (пустые/несгенерированные пропускаем).
  const filled = cards.filter((c) => !!c.name?.trim());

  // Группируем по оси+категории (как каркас Стадии 3).
  const groups = new Map<string, Card[]>();
  for (const c of filled) {
    const key = `${c.axis}|${c.category}`;
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  const groupList = [...groups.values()];
  const concurrency = genConcurrency();
  const updates: ImagePromptUpdate[] = [];
  let done = 0;
  opts.onProgress?.(0, groupList.length, `Промпты изображений: 0/${groupList.length}`);

  await mapWithLimit(groupList, concurrency, async (group) => {
    try {
      const obraz = await obrazForGroup(group);
      group.forEach((card, i) => {
        const item = obraz.get(i) || obraz.get(card.cardNumber);
        const subject = item?.subject || 'a single symbolic object';
        const stockQuery = item?.stockQuery || card.name;
        const { palette, mood } = styleFor(card);
        updates.push({
          cardId: card.id,
          imagePrompt: assemble(palette, subject, mood),
          stockQuery,
        });
      });
    } catch {
      // осечка модели на группе — пропускаем, карты этой группы останутся без промпта
    }
    done += 1;
    opts.onProgress?.(done, groupList.length, `Промпты изображений: ${done}/${groupList.length}`);
  });

  return updates;
}
