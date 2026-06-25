/**
 * Стадия 0 — Профайлер домена.
 *
 * Вход: бриф темы («колода для школ» + опц. уточнения).
 * Выход: черновик DeckProfile — доменная часть (аудитория, матрица M×C,
 * примеры под фикс-каркас, стоп-листы, тон, профиль боли).
 *
 * Каркас (типы «Я», лучи «МЫ», паттерны, гаммы, лимиты) НЕ генерируется —
 * он берётся из framework.ts. Профайлер только наполняет доменную часть.
 */

import { chatJSON } from '../llm.js';
import {
  CONTENT_TYPES,
  RAYS,
  DEFAULT_TABOO,
} from '../framework.js';
import type { DeckProfile } from '../types.js';
import type { ProgressFn } from '../jobs.js';

const SYSTEM = `Ты — Профайлер домена для конструктора учебных колод по обучению работе с ИИ.
Задача: по теме (типу организации) построить ДОМЕННОЕ ЯДРО будущей колоды.

Ты НЕ придумываешь структуру карт — она фиксирована (6 типов контента «Я» и 6 лучей «МЫ»).
Ты описываешь ДОМЕН: кто аудитория, как устроена организация этого типа, какие у неё
функциональные блоки и кластеры стейкхолдеров, и строишь матрицу тем для поиска реальных
проблемных кейсов.

ПРИНЦИПЫ КАЧЕСТВА:
- Конкретика отрасли, реальные процессы и роли, а не общие слова.
- Матрица должна покрывать весь спектр задач управления организацией этого типа.
- Каждая ячейка матрицы = пересечение функционального блока (строка) и кластера
  стейкхолдеров (столбец), с 1-3 затравочными темами для поиска кейсов.
- Профиль боли: что заставит участника сказать «это про нас!».

ФОРМАТ ВЫВОДА: строго один JSON-объект, без markdown-обёрток и текста вокруг.`;

interface RawProfile {
  audience: { name: string; description: string; segments: string[] };
  functionalBlocks: { id: string; name: string; focus: string }[];
  stakeholderClusters: { id: string; name: string; question: string }[];
  matrix: { m: string; c: string; seedThemes: string[] }[];
  rayExamples?: Record<string, string>;
  contentExamples?: Record<string, string>;
  tabooList?: string[];
  toneRules: string;
  terminologyNotes: string;
  painProfile: string;
}

function buildUserPrompt(theme: string, notes: string): string {
  const rayList = RAYS.map((r) => `${r.id} = «${r.title}»`).join('; ');
  const typeList = CONTENT_TYPES.map((t) => `${t.id} = «${t.title}»`).join('; ');
  return `ТЕМА КОЛОДЫ: ${theme}
${notes ? `УТОЧНЕНИЯ: ${notes}` : ''}

Построй доменное ядро. Верни JSON со следующими полями:

{
  "audience": { "name": "...", "description": "1-2 предложения", "segments": ["роль1","роль2","..."] },
  "functionalBlocks": [ { "id": "M1", "name": "...", "focus": "что входит в блок" }, ... 5 блоков M1..M5 ],
  "stakeholderClusters": [ { "id": "C1", "name": "...", "question": "Для кого?/Что предлагаем?/..." }, ... 5 кластеров C1..C5 ],
  "matrix": [ { "m": "M1", "c": "C1", "seedThemes": ["тема1","тема2"] }, ... ВСЕ 25 ячеек M×C ],
  "contentExamples": { ${CONTENT_TYPES.map((t) => `"${t.id}": "пример применения типа в этом домене"`).join(', ')} },
  "rayExamples": { ${RAYS.map((r) => `"${r.id}": "пример применения луча в этом домене"`).join(', ')} },
  "tabooList": ["доп. запретные темы под этот домен (можно пусто)"],
  "toneRules": "тональность и стиль карт для этой аудитории",
  "terminologyNotes": "отраслевой жаргон и термины, которые делают карты узнаваемыми",
  "painProfile": "что заставит участника сказать «это про нас!» — типовые боли этой аудитории"
}

Справочно (НЕ генерируй их, только используй id в *Examples):
- Типы контента «Я»: ${typeList}
- Лучи «МЫ»: ${rayList}

Требования: ровно 5 функциональных блоков, 5 кластеров, и ВСЕ 25 ячеек матрицы (5×5).`;
}

function validate(v: unknown): RawProfile {
  const p = v as RawProfile;
  if (!p || typeof p !== 'object') throw new Error('ожидался объект профиля');
  if (!p.audience?.name) throw new Error('нет audience.name');
  if (!Array.isArray(p.functionalBlocks) || p.functionalBlocks.length < 4)
    throw new Error('нужно ≥4 functionalBlocks');
  if (!Array.isArray(p.stakeholderClusters) || p.stakeholderClusters.length < 4)
    throw new Error('нужно ≥4 stakeholderClusters');
  if (!Array.isArray(p.matrix) || p.matrix.length < 16)
    throw new Error('нужна заполненная матрица (≥16 ячеек)');
  if (!p.painProfile) throw new Error('нет painProfile');
  return p;
}

/** Метаданные стадии для UI-панели промптов (дефолтная система + пример user-промпта). */
export const PROFILER_STAGE = {
  key: 'profiler' as const,
  title: 'Стадия 0 · Профайлер (ядро)',
  defaultSystem: SYSTEM,
  buildUserExample: (theme: string, notes = '') => buildUserPrompt(theme || 'Пример темы', notes),
};

/** Запускает Профайлер и собирает полный DeckProfile (домен + наследование стоп-листа). */
export async function runProfiler(
  theme: string,
  notes: string,
  opts: { systemPrompt?: string; onProgress?: ProgressFn } = {}
): Promise<DeckProfile> {
  // Один LLM-вызов — промежуточных шагов нет, отмечаем единственный этап.
  opts.onProgress?.(0, 1, 'Генерация доменного ядра…');
  const raw = await chatJSON<RawProfile>(
    [
      { role: 'system', content: opts.systemPrompt || SYSTEM },
      { role: 'user', content: buildUserPrompt(theme, notes) },
    ],
    { temperature: 0.5, retries: 2, validate }
  );

  const taboo = Array.from(
    new Set([...DEFAULT_TABOO, ...((raw.tabooList ?? []).filter(Boolean))])
  );

  return {
    theme,
    audience: raw.audience,
    functionalBlocks: raw.functionalBlocks,
    stakeholderClusters: raw.stakeholderClusters,
    matrix: raw.matrix,
    rayExamples: raw.rayExamples ?? {},
    contentExamples: raw.contentExamples ?? {},
    tabooList: taboo,
    toneRules: raw.toneRules ?? '',
    terminologyNotes: raw.terminologyNotes ?? '',
    painProfile: raw.painProfile,
  };
}
