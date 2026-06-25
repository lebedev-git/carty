/**
 * Стадия 2 — Валидация и скоринг кейсов (методология «МАЯК», раздел 10.4).
 *
 * Три этапа:
 *  1. Дедупликация — кейсы об одной ситуации схлопываются (остаётся с наименьшим id).
 *  2. Скоринг 0–100 по 5 критериям (модель даёт под-оценки, СУММУ считает код).
 *  3. Типизация «Я» (инструментальная) / «МЫ» (стратегическая).
 *
 * Детерминизм: порог 80+ и квоты 16/16 считаются КОДОМ по структурным под-оценкам,
 * а не «на доверии» к итоговому числу от модели.
 */

import { chatJSON } from '../llm.js';
import { CONTENT_TYPES, RAYS, DEFAULT_QUALITY_TARGETS } from '../framework.js';
import type { Case, DeckProfile } from '../types.js';
import type { CaseValidation } from '../db.js';
import type { ProgressFn } from '../jobs.js';

/** Максимумы под-оценок (в сумме 100). */
const CRITERIA: { key: string; label: string; max: number }[] = [
  { key: 'relevance', label: 'Соответствие теме/аудитории', max: 25 },
  { key: 'specificity', label: 'Конкретика и детализация', max: 25 },
  { key: 'drama', label: 'Драматургия и конфликт', max: 20 },
  { key: 'practical', label: 'Практический потенциал', max: 20 },
  { key: 'emotional', label: 'Эмоциональная вовлекающая сила', max: 10 },
];
const QUOTA_THRESHOLD = 80;
const BATCH_SIZE = 10;

/** System-промпт скоринга (редактируемая поверхность стадии). Дедуп — внутренний. */
const SCORE_SYSTEM =
  'Ты — Главный Методолог и Аудитор. Строго и честно оцениваешь учебные кейсы. Отвечай только JSON.';

export interface ValidationResult {
  results: { id: number; validation: CaseValidation }[];
  quota: {
    threshold: number;
    target: number;
    yaActive: number;
    weActive: number;
    met: boolean;
    duplicates: number;
  };
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// --- Этап 1: дедупликация (мягкая — при сбое просто никого не схлопываем) ---

async function findDuplicates(cases: Case[]): Promise<Set<number>> {
  const list = cases.map((c) => `${c.id}: [${c.matrixCell}] ${c.title} — ${c.summary}`).join('\n');
  try {
    const res = await chatJSON<{ groups: number[][] }>(
      [
        {
          role: 'system',
          content:
            'Ты — аудитор кейсов. Находишь кейсы об ОДНОЙ И ТОЙ ЖЕ ситуации (дубликаты по сути). Отвечай строго JSON.',
        },
        {
          role: 'user',
          content: `Кейсы (id: текст):
${list}

Сгруппируй id, которые описывают по сути одну ситуацию (дубликаты). Уникальные кейсы НЕ включай.
Верни строго JSON: { "groups": [[id, id, ...], ...] }. Если дубликатов нет — { "groups": [] }.`,
        },
      ],
      {
        temperature: 0.1,
        retries: 1,
        validate: (v) => {
          const o = v as { groups: number[][] };
          if (!o || !Array.isArray(o.groups)) throw new Error('нет groups[]');
          return o;
        },
      }
    );
    const dup = new Set<number>();
    for (const g of res.groups) {
      const ids = g.filter((x) => typeof x === 'number').sort((a, b) => a - b);
      // оставляем наименьший id, остальные — дубликаты
      ids.slice(1).forEach((id) => dup.add(id));
    }
    return dup;
  } catch {
    // дедуп не критичен — продолжаем без него
    return new Set<number>();
  }
}

// --- Этап 2+3: скоринг и типизация (батчами) ---

interface RawScore {
  id: number;
  scores: Record<string, number>;
  group: 'Я' | 'МЫ';
  taboo?: boolean;
  analytics?: string;
}

function buildScorePrompt(profile: DeckProfile, batch: Case[]): string {
  const typeList = CONTENT_TYPES.map((t) => t.title).join(', ');
  const rayList = RAYS.map((r) => r.title).join(', ');
  const items = batch.map((c) => `${c.id}: [${c.matrixCell}] ${c.title} — ${c.summary}`).join('\n');
  const crit = CRITERIA.map((c) => `  "${c.key}": 0-${c.max}  // ${c.label}`).join('\n');
  return `ТЕМА: ${profile.theme} — ${profile.audience.name}.
БОЛИ АУДИТОРИИ: ${profile.painProfile}
СТОП-ЛИСТ (если кейс нарушает — taboo=true): ${profile.tabooList.join('; ')}

Оцени каждый кейс по 5 критериям и определи ГРУППУ:
- «Я» — из кейса можно сделать конкретный артефакт-контент (${typeList}).
- «МЫ» — кейс требует системного документа/стратегии (лучи: ${rayList}).

КЕЙСЫ:
${items}

Верни строго JSON:
{
  "scores": [
    {
      "id": <id>,
      "scores": {
${crit}
      },
      "group": "Я" | "МЫ",
      "taboo": false,
      "analytics": "1 короткое предложение — чем кейс ценен или почему слаб"
    }
  ]
}
Оцени ВСЕ ${batch.length} кейсов.`;
}

function clampScores(raw: Record<string, number>): { breakdown: Record<string, number>; total: number } {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const c of CRITERIA) {
    const v = Math.max(0, Math.min(c.max, Math.round(Number(raw?.[c.key]) || 0)));
    breakdown[c.label] = v;
    total += v;
  }
  return { breakdown, total };
}

async function scoreBatch(
  profile: DeckProfile,
  batch: Case[],
  systemPrompt?: string
): Promise<Map<number, RawScore>> {
  const res = await chatJSON<{ scores: RawScore[] }>(
    [
      { role: 'system', content: systemPrompt || SCORE_SYSTEM },
      { role: 'user', content: buildScorePrompt(profile, batch) },
    ],
    {
      temperature: 0.3,
      retries: 2,
      validate: (v) => {
        const o = v as { scores: RawScore[] };
        if (!o || !Array.isArray(o.scores)) throw new Error('нет scores[]');
        return o;
      },
    }
  );
  const map = new Map<number, RawScore>();
  for (const s of res.scores) if (typeof s?.id === 'number') map.set(s.id, s);
  return map;
}

/** Пара кейсов-примеров из seed-тем матрицы — чтобы показать user-промпт до Стадии 1. */
function sampleCases(profile: DeckProfile): Case[] {
  const seeds = profile.matrix.flatMap((m) =>
    m.seedThemes.map((t) => ({ cell: `${m.m}×${m.c}`, theme: t }))
  );
  const pick = seeds.slice(0, 2);
  if (pick.length === 0) return [];
  return pick.map((s, i) => ({
    id: i + 1,
    deckId: 0,
    title: s.theme,
    summary: `Типовая болевая ситуация по теме «${s.theme}» (${profile.audience.name}).`,
    source: 'пример',
    problemType: '',
    matrixCell: s.cell,
  }));
}

/** Метаданные стадии для UI-панели промптов. */
export const VALIDATOR_STAGE = {
  key: 'validator' as const,
  title: 'Стадия 2 · Валидация и скоринг',
  defaultSystem: SCORE_SYSTEM,
  buildUserExample: (profile: DeckProfile, cases?: Case[]) => {
    const batch = cases && cases.length ? cases.slice(0, BATCH_SIZE) : sampleCases(profile);
    return batch.length ? buildScorePrompt(profile, batch) : '(пример появится после генерации ядра)';
  },
};

export async function runValidator(
  profile: DeckProfile,
  cases: Case[],
  opts: { systemPrompt?: string; onProgress?: ProgressFn } = {}
): Promise<ValidationResult> {
  const toScoreCount = cases.length; // верхняя оценка для шкалы прогресса
  const batchesTotal = Math.max(1, Math.ceil(toScoreCount / BATCH_SIZE));
  const total = 1 + batchesTotal; // этап дедупа + батчи скоринга

  opts.onProgress?.(0, total, 'Дедупликация кейсов…');
  const duplicates = await findDuplicates(cases);
  const toScore = cases.filter((c) => !duplicates.has(c.id));

  // скорим батчами последовательно (щадим фритир)
  const scoreMap = new Map<number, RawScore>();
  const batches = chunk(toScore, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    opts.onProgress?.(1 + i, total, `Скоринг кейсов: батч ${i + 1}/${batches.length}`);
    const m = await scoreBatch(profile, batches[i], opts.systemPrompt);
    for (const [id, s] of m) scoreMap.set(id, s);
  }

  const results: { id: number; validation: CaseValidation }[] = cases.map((c) => {
    if (duplicates.has(c.id)) {
      return {
        id: c.id,
        validation: {
          score: 0,
          scoreBreakdown: {},
          group: null,
          status: 'duplicate',
          analytics: 'Дубликат (схлопнут с более ранним кейсом).',
        },
      };
    }
    const raw = scoreMap.get(c.id);
    if (!raw) {
      return {
        id: c.id,
        validation: {
          score: 0,
          scoreBreakdown: {},
          group: null,
          status: 'rejected',
          analytics: 'Не удалось оценить.',
        },
      };
    }
    const { breakdown, total } = clampScores(raw.scores);
    const taboo = raw.taboo === true;
    return {
      id: c.id,
      validation: {
        score: taboo ? 0 : total,
        scoreBreakdown: breakdown,
        group: raw.group === 'Я' || raw.group === 'МЫ' ? raw.group : null,
        status: taboo ? 'rejected' : 'active',
        analytics: (raw.analytics ?? '').trim(),
      },
    };
  });

  const target = DEFAULT_QUALITY_TARGETS.minCardsPerAxis; // 16
  const active80 = (g: 'Я' | 'МЫ') =>
    results.filter(
      (r) => r.validation.status === 'active' && r.validation.group === g && r.validation.score >= QUOTA_THRESHOLD
    ).length;
  const yaActive = active80('Я');
  const weActive = active80('МЫ');

  return {
    results,
    quota: {
      threshold: QUOTA_THRESHOLD,
      target,
      yaActive,
      weActive,
      met: yaActive >= target && weActive >= target,
      duplicates: duplicates.size,
    },
  };
}
