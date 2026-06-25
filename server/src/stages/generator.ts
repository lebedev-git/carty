/**
 * Стадия 3 — Генерация карт (методология «МАЯК», раздел 10.5).
 *
 * Вход: замороженный профиль + провалидированные кейсы (Стадия 2).
 * Выход: 36 карт оси «Я» (6 типов контента × 6 паттернов) и 36 карт оси «МЫ»
 *        (6 лучей × 6 паттернов) = 72 карты, привязанные к фикс-каркасу.
 *
 * Три этапа:
 *  1. ПЛАНИРОВЩИК (детерминированный, без LLM) — распределяет активные кейсы по
 *     72 слотам каркаса. Один кейс питает не более 3 карт и не более 1 карты на
 *     категорию (тип/луч), чтобы колода не повторялась. Слотам без кейса источник
 *     не назначается — карта синтезируется из паттерна и профиля боли.
 *  2. ГЕНЕРАТОР (LLM, батчами по категории) — 6 паттернов одной категории за один
 *     вызов: имя/описание/задача + самооценка «боли» (painScore 0-100). 12 вызовов
 *     на колоду — щадим бесплатный фритир, как на Стадиях 1-2.
 *  3. ПРОВЕРКА ЛИМИТОВ (детерминированная, без LLM) — длины полей, англицизмы,
 *     упоминания ИИ, конкретные даты. Итог: passed = лимиты OK И painScore >= порога.
 *
 * Детерминизм: вердикт «прошла/не прошла» считает КОД по структурным сигналам,
 * а не «на доверии» к модели — та же философия, что и скоринг Стадии 2.
 */

import { chatJSON } from '../llm.js';
import {
  CONTENT_TYPES,
  RAYS,
  CARD_CONSTRAINTS,
  BANNED_ANGLICISMS,
  type Pattern,
} from '../framework.js';
import type { Card, Case, DeckProfile } from '../types.js';
import type { RawCardInput } from '../db.js';
import type { ProgressFn } from '../jobs.js';

/** Порог самооценки «боли», ниже которого карта считается слабой. */
export const PAIN_THRESHOLD = 70;
/** Сколько карт максимум питает один кейс. */
const MAX_CASE_REUSE = 3;
/** Сколько раз переспрашивать модель, доводя поля карты до диапазона длины. */
const MAX_FIX_ATTEMPTS = 3;
/** Сколько раз пересобирать категорию целиком, если раздел вышел неполным/упал. */
const SECTION_MAX_ATTEMPTS = 3;

interface CategoryDef {
  axis: 'Я' | 'МЫ';
  id: string; // typeId ('TEXT'...) или rayId ('KNOWLEDGE'...)
  title: string; // отображаемое имя категории
  patterns: Pattern[]; // ровно 6
}

/** Плоский список категорий обеих осей в каноническом порядке каркаса. */
function categories(): CategoryDef[] {
  const ya: CategoryDef[] = CONTENT_TYPES.map((t) => ({
    axis: 'Я',
    id: t.id,
    title: t.title,
    patterns: t.patterns,
  }));
  const we: CategoryDef[] = RAYS.map((r) => ({
    axis: 'МЫ',
    id: r.id,
    title: r.title,
    patterns: r.patterns,
  }));
  return [...ya, ...we];
}

/** Слот каркаса с (опционально) назначенным кейсом-источником. */
interface SlotPlan {
  axis: 'Я' | 'МЫ';
  categoryId: string;
  categoryTitle: string;
  patternIndex: number;
  pattern: Pattern;
  cardNumber: number; // 1..36 в пределах оси
  sourceCase: Case | null;
}

// --- Этап 1: планировщик (детерминированный) ---

/**
 * Распределяет активные кейсы группы по слотам одной оси.
 * Жадно, с равномерным расходом: для слота берём наименее использованный
 * подходящий кейс (исп. < MAX_CASE_REUSE и ещё не занятый в этой категории),
 * предпочитая более высокий балл. Если подходящего нет — слот без источника.
 */
function planAxis(axis: 'Я' | 'МЫ', cats: CategoryDef[], cases: Case[]): SlotPlan[] {
  const pool = cases
    .filter((c) => c.status === 'active' && c.group === axis)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const usage = new Map<number, number>(); // caseId -> сколько раз использован
  const usedInCategory = new Map<string, Set<number>>(); // categoryId -> set caseId

  const plans: SlotPlan[] = [];
  let cardNumber = 0;
  for (const cat of cats) {
    const seen = usedInCategory.get(cat.id) ?? new Set<number>();
    usedInCategory.set(cat.id, seen);
    cat.patterns.forEach((pattern, patternIndex) => {
      cardNumber += 1;
      const candidate = pool
        .filter((c) => (usage.get(c.id) ?? 0) < MAX_CASE_REUSE && !seen.has(c.id))
        .sort((a, b) => {
          const ua = usage.get(a.id) ?? 0;
          const ub = usage.get(b.id) ?? 0;
          if (ua !== ub) return ua - ub; // сначала наименее использованные
          return (b.score ?? 0) - (a.score ?? 0); // затем по баллу
        })[0];
      if (candidate) {
        usage.set(candidate.id, (usage.get(candidate.id) ?? 0) + 1);
        seen.add(candidate.id);
      }
      plans.push({
        axis,
        categoryId: cat.id,
        categoryTitle: cat.title,
        patternIndex,
        pattern,
        cardNumber,
        sourceCase: candidate ?? null,
      });
    });
  }
  return plans;
}

// --- Этап 2: генерация текста карт (LLM, батч на категорию) ---

interface RawCard {
  patternIndex: number;
  name: string;
  description: string;
  task: string;
  painScore?: number;
  painNote?: string;
}

const SYSTEM = `Ты — методолог-копирайтер обучающих карт системы «МАЯК». Каждая карта — это
учебное задание-вызов, попадающее в «боль» участника: он узнаёт свою рабочую ситуацию
и хочет немедленно её решить.

ЖЁСТКИЕ ПРАВИЛА:
- НЕ упоминай инструмент решения: никаких «ИИ», «AI», «нейросеть», «искусственный интеллект».
  Карта описывает ЗАДАЧУ и РЕЗУЛЬТАТ, а не технологию.
- Без англицизмов и аббревиатур-калек (KPI, ROI, CRM, SWOT и т.п.) — только русские эквиваленты.
- Без конкретных дат и годов.
- Соблюдай стоп-лист.

ДЛИНА ПОЛЕЙ — КРИТИЧНА. Каждое поле автоматически измеряется в символах (с пробелами);
карта вне диапазона ОТБРАКОВЫВАЕТСЯ. Перед ответом мысленно посчитай длину каждого поля
и подгони: слишком коротко — добавь деталей, слишком длинно — сократи. Целься в СЕРЕДИНУ
диапазона, а не в край.

ФОРМАТ ВЫВОДА: строго один JSON-объект, без markdown-обёрток и текста вокруг.`;

function buildGenPrompt(profile: DeckProfile, cat: CategoryDef, slots: SlotPlan[]): string {
  const axisHint =
    cat.axis === 'Я'
      ? `Ось «Я» — индивидуальная карта. Тип контента: «${cat.title}». Результат — конкретный артефакт этого типа.`
      : `Ось «МЫ» — командная/стратегическая карта. Луч: «${cat.title}». Результат — системный документ/решение для организации.`;

  const items = slots
    .map((s) => {
      const src = s.sourceCase
        ? `кейс-основа: «${s.sourceCase.title}» — ${s.sourceCase.summary}`
        : 'кейса-основы нет — синтезируй типовую болевую ситуацию аудитории по профилю боли';
      return `  - patternIndex ${s.patternIndex}: паттерн «${s.pattern.name}» (тип задачи: ${s.pattern.taskType}); ${src}`;
    })
    .join('\n');

  const C = CARD_CONSTRAINTS;
  // Модель плохо считает символы, но хорошо целится в слова/предложения.
  // Рус. текст с пробелами ≈ 6.5 символа на слово — даём ориентир в словах.
  const words = (chars: number) => Math.round(chars / 6.5);
  // Цель — НИЖНЯЯ треть диапазона: модели склонны перебирать верхнюю границу.
  const aimChars = (min: number, max: number) => Math.round(min + (max - min) * 0.3);
  const aim = (min: number, max: number) => `${aimChars(min, max)} симв. (≈${words(aimChars(min, max))} слов)`;
  return `ОБЛАСТЬ: ${profile.theme} — ${profile.audience.name}.
АУДИТОРИЯ: ${profile.audience.description}
БОЛИ АУДИТОРИИ: ${profile.painProfile}
ТОН: ${profile.toneRules}
${profile.terminologyNotes ? `ТЕРМИНОЛОГИЯ: ${profile.terminologyNotes}` : ''}
СТОП-ЛИСТ (запрещено): ${profile.tabooList.join('; ')}

${axisHint}

Сгенерируй карту для КАЖДОГО из ${slots.length} паттернов ниже:
${items}

РАЗМЕРЫ ПОЛЕЙ — ЖЁСТКОЕ ТРЕБОВАНИЕ. Каждое поле автоматически измеряется в символах
(с пробелами). Выход за диапазон ХОТЬ НА ОДИН символ → карта ОТБРАКОВЫВАЕТСЯ. Перебор
верхней границы — частая ошибка: ЛУЧШЕ КОРОЧЕ, чем длиннее. Целься в указанный ориентир
(нижняя треть диапазона), НЕ в верхнюю границу.
- name: диапазон ${C.nameMin}-${C.nameMax} симв., цель ≈ ${aim(C.nameMin, C.nameMax)} — короткое название в 2-3 слова, НЕ фраза.
- description: диапазон ${C.descriptionMin}-${C.descriptionMax} симв., цель ≈ ${aim(
    C.descriptionMin,
    C.descriptionMax
  )} — ровно 3 коротких предложения. Болевая ситуация: кто, что произошло, в чём конфликт и дефицит времени/ресурса. Не лей воду — каждое предложение по делу, иначе перебёрешь потолок ${C.descriptionMax}.
- task: диапазон ${C.taskMin}-${C.taskMax} симв., цель ≈ ${aim(
    C.taskMin,
    C.taskMax
  )} — ровно 2 коротких предложения: что участник создаёт/преобразует под тип «${cat.title}» и с каким результатом.

ПЕРЕД ВЫВОДОМ по каждой карте мысленно прикинь длину каждого поля по словам
(${words(C.descriptionMin)}-${words(C.descriptionMax)} слов для description, ${words(C.taskMin)}-${words(
    C.taskMax
  )} для task) и, если длиннее цели, ВЫЧЕРКНИ лишнее, пока не уложишься.

Верни строго JSON:
{
  "cards": [
    {
      "patternIndex": <число из списка>,
      "name": "...",
      "description": "...",
      "task": "...",
      "painScore": <0-100, насколько остро карта бьёт в боль аудитории>,
      "painNote": "1 короткая фраза — чем карта цепляет"
    }
  ]
}
Верни ровно ${slots.length} карт, по одной на каждый patternIndex из списка.`;
}

async function generateCategory(
  profile: DeckProfile,
  cat: CategoryDef,
  slots: SlotPlan[],
  systemPrompt?: string
): Promise<Map<number, RawCard>> {
  const res = await chatJSON<{ cards: RawCard[] }>(
    [
      { role: 'system', content: systemPrompt || SYSTEM },
      { role: 'user', content: buildGenPrompt(profile, cat, slots) },
    ],
    {
      temperature: 0.7,
      retries: 2,
      validate: (v) => {
        const o = v as { cards: RawCard[] };
        if (!o || !Array.isArray(o.cards)) throw new Error('нет cards[]');
        for (const c of o.cards) {
          if (typeof c?.patternIndex !== 'number' || !c?.name || !c?.description || !c?.task)
            throw new Error('у карты нет patternIndex/name/description/task');
        }
        return o;
      },
    }
  );
  const map = new Map<number, RawCard>();
  for (const c of res.cards) if (typeof c.patternIndex === 'number') map.set(c.patternIndex, c);
  return map;
}

/** Карта слота считается валидной, если все три текстовых поля непусты. */
function isCardFilled(card: RawCard | undefined): card is RawCard {
  return !!card && !!card.name?.trim() && !!card.description?.trim() && !!card.task?.trim();
}

/** Сколько слотов раздела покрыто валидными картами. */
function coveredCount(slots: SlotPlan[], map: Map<number, RawCard>): number {
  return slots.filter((s) => isCardFilled(map.get(s.patternIndex))).length;
}

/**
 * Генерация категории с проверкой полноты раздела и ретраями.
 * После каждой попытки проверяем, что на КАЖДЫЙ слот есть валидная карта; если нет —
 * пересобираем (до SECTION_MAX_ATTEMPTS), накапливая валидные карты между попытками
 * (частичный успех не теряется). Возвращает максимально полную карту раздела.
 */
async function generateCategoryChecked(
  profile: DeckProfile,
  cat: CategoryDef,
  slots: SlotPlan[],
  systemPrompt: string | undefined,
  onAttempt?: (attempt: number, covered: number) => void
): Promise<Map<number, RawCard>> {
  const acc = new Map<number, RawCard>();
  for (let attempt = 1; attempt <= SECTION_MAX_ATTEMPTS; attempt++) {
    if (coveredCount(slots, acc) === slots.length) break; // раздел уже полон
    try {
      const m = await generateCategory(profile, cat, slots, systemPrompt);
      for (const s of slots) {
        // оставляем первую валидную версию каждого слота, добираем недостающие
        if (!isCardFilled(acc.get(s.patternIndex)) && isCardFilled(m.get(s.patternIndex))) {
          acc.set(s.patternIndex, m.get(s.patternIndex)!);
        }
      }
    } catch {
      // осечка модели на этой попытке — пробуем ещё раз
    }
    onAttempt?.(attempt, coveredCount(slots, acc));
  }
  return acc;
}

/**
 * Параллельный обход с ограничением одновременности.
 * worker не бросает наружу — ошибки гасятся вызывающим (по категории).
 */
export async function mapWithLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

/**
 * Сколько категорий генерировать одновременно.
 * - claude-cli: локальный клиент без поминутных лимитов — гоним пачками (по умолчанию 4),
 *   переопределяется CLAUDE_CLI_CONCURRENCY.
 * - openrouter: бесплатный фритир жёстко лимитирован по rpm — оставляем строго по одному,
 *   иначе посыплются 429.
 */
export function genConcurrency(): number {
  const provider = (process.env.LLM_PROVIDER || 'openrouter').toLowerCase();
  if (provider === 'claude-cli') return Number(process.env.CLAUDE_CLI_CONCURRENCY) || 4;
  // openmodel: фритир ~10 rpm — держим умеренную пачку (бэкофф на 429 страхует).
  if (provider === 'openmodel') return Number(process.env.OPENMODEL_CONCURRENCY) || 3;
  return 1;
}

// --- Этап 3: проверка лимитов (детерминированная) ---

const DATE_RE = /\b(19|20)\d{2}\b|\b\d{1,2}\.\d{1,2}(\.\d{2,4})?\b/;
const AI_RE = /\b(ии|ai)\b|нейросет|искусственн\w*\s+интеллект/i;

/** Проверяет одну карту на нарушения лимитов; возвращает список замечаний. */
export function checkConstraints(name: string, description: string, task: string): string[] {
  const issues: string[] = [];
  const C = CARD_CONSTRAINTS;
  const nameLen = [...name].length;
  const descLen = [...description].length;
  const taskLen = [...task].length;
  if (nameLen < C.nameMin || nameLen > C.nameMax)
    issues.push(`имя ${nameLen} симв. (нужно ${C.nameMin}-${C.nameMax})`);
  if (descLen < C.descriptionMin || descLen > C.descriptionMax)
    issues.push(`описание ${descLen} симв. (нужно ${C.descriptionMin}-${C.descriptionMax})`);
  if (taskLen < C.taskMin || taskLen > C.taskMax)
    issues.push(`задача ${taskLen} симв. (нужно ${C.taskMin}-${C.taskMax})`);

  const blob = `${name}\n${description}\n${task}`;
  if (AI_RE.test(blob)) issues.push('упоминание ИИ/нейросети');
  if (DATE_RE.test(blob)) issues.push('конкретная дата/год');
  const hits = BANNED_ANGLICISMS.filter((w) =>
    new RegExp(`\\b${w}\\b`, 'i').test(blob)
  );
  if (hits.length) issues.push(`англицизмы: ${hits.join(', ')}`);
  return issues;
}

// --- Этап 2.5: доводка длины (LLM, точечно по проблемной карте) ---

/** Точные указания по каждому полю вне диапазона: насколько и в какую сторону править. */
function lengthDirectives(name: string, description: string, task: string): string[] {
  const C = CARD_CONSTRAINTS;
  const out: string[] = [];
  const check = (label: string, val: string, min: number, max: number) => {
    const len = [...val].length;
    if (len < min)
      out.push(
        `${label}: сейчас ${len} симв., нужно ${min}-${max} — УДЛИНИ на ${min - len}-${max - len} симв. (добавь конкретики, не меняя смысл).`
      );
    else if (len > max)
      out.push(
        `${label}: сейчас ${len} симв., нужно ${min}-${max} — СОКРАТИ на ${len - max}-${len - min} симв. (убери лишнее, сохрани суть).`
      );
  };
  check('name (название)', name, C.nameMin, C.nameMax);
  check('description (описание)', description, C.descriptionMin, C.descriptionMax);
  check('task (задача)', task, C.taskMin, C.taskMax);
  return out;
}

const FIX_SYSTEM = `Ты — редактор обучающих карт «МАЯК». Тебе дают готовую карту и точные замечания
по длине полей. Исправь ТОЛЬКО указанные поля, сохранив смысл, тон и все ограничения
(без упоминаний ИИ, без англицизмов, без конкретных дат). Меняй длину аккуратно — попадай
в СЕРЕДИНУ требуемого диапазона. Верни строго один JSON-объект без markdown.`;

function buildFixPrompt(card: RawCard, issues: string[]): string {
  return `Карта:
{
  "name": ${JSON.stringify(card.name)},
  "description": ${JSON.stringify(card.description)},
  "task": ${JSON.stringify(card.task)}
}

Замечания по длине (исправь каждое, целься в середину диапазона):
${issues.map((i) => `- ${i}`).join('\n')}

Верни исправленную карту строго JSON:
{ "name": "...", "description": "...", "task": "..." }`;
}

/**
 * Доводит карту до диапазонов длины: до MAX_FIX_ATTEMPTS точечных переспросов.
 * Возвращает наилучшую версию (с наименьшим числом нарушений). Ошибки модели не
 * валят процесс — возвращаем то, что есть.
 */
async function fixCardLength(card: RawCard, systemPrompt?: string): Promise<RawCard> {
  let best = card;
  let bestIssues = checkConstraints(card.name, card.description, card.task).length;
  for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS && bestIssues > 0; attempt++) {
    const directives = lengthDirectives(best.name, best.description, best.task);
    if (directives.length === 0) break; // вне диапазона только не-длиновые замечания — доводка не поможет
    try {
      const res = await chatJSON<{ name: string; description: string; task: string }>(
        [
          { role: 'system', content: FIX_SYSTEM },
          { role: 'user', content: buildFixPrompt(best, directives) },
        ],
        {
          temperature: 0.4,
          retries: 1,
          validate: (v) => {
            const o = v as { name: string; description: string; task: string };
            if (!o?.name || !o?.description || !o?.task) throw new Error('нет name/description/task');
            return o;
          },
        }
      );
      const candidate: RawCard = {
        ...best,
        name: res.name.trim(),
        description: res.description.trim(),
        task: res.task.trim(),
      };
      const candIssues = checkConstraints(candidate.name, candidate.description, candidate.task).length;
      if (candIssues < bestIssues) {
        best = candidate;
        bestIssues = candIssues;
      }
    } catch {
      break; // осечка модели — оставляем лучшую версию
    }
  }
  return best;
}

// --- Сборка стадии ---

export interface GeneratorReport {
  cards: RawCardInput[];
  summary: {
    total: number;
    passed: number;
    withSource: number;
    yaCount: number;
    weCount: number;
  };
}

/** Метаданные стадии для UI-панели промптов (пример — первая категория, без кейса-основы). */
export const GENERATOR_STAGE = {
  key: 'generator' as const,
  title: 'Стадия 3 · Генерация карт',
  defaultSystem: SYSTEM,
  buildUserExample: (profile: DeckProfile) => {
    const cat = categories()[0];
    const slots: SlotPlan[] = cat.patterns.map((pattern, patternIndex) => ({
      axis: cat.axis,
      categoryId: cat.id,
      categoryTitle: cat.title,
      patternIndex,
      pattern,
      cardNumber: patternIndex + 1,
      sourceCase: null,
    }));
    return buildGenPrompt(profile, cat, slots);
  },
};

export async function runGenerator(
  profile: DeckProfile,
  cases: Case[],
  opts: { systemPrompt?: string; onProgress?: ProgressFn } = {}
): Promise<GeneratorReport> {
  const cats = categories();
  const yaCats = cats.filter((c) => c.axis === 'Я');
  const weCats = cats.filter((c) => c.axis === 'МЫ');

  // 1. План (детерминированный)
  const plans = [...planAxis('Я', yaCats, cases), ...planAxis('МЫ', weCats, cases)];

  // 2. Генерация — по категории, пачками (concurrency зависит от провайдера).
  // Map.set безопасен между await'ами: JS однопоточен, гонок за ключи нет.
  const generated = new Map<string, RawCard>(); // ключ: `${categoryId}#${patternIndex}`
  const concurrency = genConcurrency();
  let done = 0;
  opts.onProgress?.(0, cats.length, `Генерация карт (до ${concurrency} параллельно)…`);
  const incomplete: string[] = []; // категории, что не добрались до полного раздела
  await mapWithLimit(cats, concurrency, async (cat) => {
    const slots = plans.filter((p) => p.categoryId === cat.id);
    // Генерация с проверкой полноты раздела и ретраями (до SECTION_MAX_ATTEMPTS).
    const m = await generateCategoryChecked(profile, cat, slots, opts.systemPrompt);
    for (const [pi, card] of m) generated.set(`${cat.id}#${pi}`, card);
    if (coveredCount(slots, m) < slots.length) incomplete.push(cat.title);
    done += 1;
    const suffix = incomplete.length ? ` · недобрано: ${incomplete.length}` : '';
    opts.onProgress?.(done, cats.length, `Готово категорий: ${done}/${cats.length}${suffix}`);
  });

  // 2.5. Доводка длины — отдельной фазой, параллельно (тот же лимит), чтобы не
  // тормозить последовательными переспросами внутри категории. Правим только карты
  // с нарушениями лимитов; остальные не трогаем.
  const toFix = [...generated.entries()].filter(
    ([, card]) => checkConstraints(card.name, card.description, card.task).length > 0
  );
  if (toFix.length) {
    let fixed = 0;
    opts.onProgress?.(cats.length, cats.length, `Доводка длины: 0/${toFix.length}`);
    await mapWithLimit(toFix, concurrency, async ([key, card]) => {
      const better = await fixCardLength(card, opts.systemPrompt);
      generated.set(key, better);
      fixed += 1;
      opts.onProgress?.(cats.length, cats.length, `Доводка длины: ${fixed}/${toFix.length}`);
    });
  }

  // 3. Сборка карт + детерминированная проверка лимитов
  const cards: RawCardInput[] = plans.map((p) => {
    const raw = generated.get(`${p.categoryId}#${p.patternIndex}`);
    const name = (raw?.name ?? '').trim();
    const description = (raw?.description ?? '').trim();
    const task = (raw?.task ?? '').trim();
    const painScore = Math.max(0, Math.min(100, Math.round(Number(raw?.painScore) || 0)));

    const constraintIssues = raw
      ? checkConstraints(name, description, task)
      : ['карта не сгенерирована'];
    const passed = constraintIssues.length === 0 && painScore >= PAIN_THRESHOLD;

    return {
      axis: p.axis,
      sourceCaseId: p.sourceCase?.id ?? null,
      cardNumber: p.cardNumber,
      name,
      category: p.categoryTitle,
      patternName: p.pattern.name,
      description,
      task,
      extraMaterialType: p.pattern.taskType,
      qualityVerdict: {
        passed,
        painScore,
        constraintIssues,
        judgeNotes: (raw?.painNote ?? '').trim(),
      },
    };
  });

  return {
    cards,
    summary: {
      total: cards.length,
      passed: cards.filter((c) => c.qualityVerdict?.passed).length,
      withSource: cards.filter((c) => c.sourceCaseId != null).length,
      yaCount: cards.filter((c) => c.axis === 'Я').length,
      weCount: cards.filter((c) => c.axis === 'МЫ').length,
    },
  };
}

// --- Точечная доводка слабых карт (без полной перегенерации) ---

export interface DoctorUpdate {
  cardId: number;
  name: string;
  description: string;
  task: string;
  qualityVerdict: Card['qualityVerdict'];
}

/** Карты с контентом и нарушением длины — кандидаты на точечную доводку. */
export function weakLengthCards(cards: Card[]): Card[] {
  return cards.filter(
    (c) => !!c.name?.trim() && lengthDirectives(c.name, c.description, c.task).length > 0
  );
}

/**
 * Доводит длину ТОЛЬКО проблемных карт (по lengthDirectives), не трогая конвейер целиком.
 * Дёшево: N запросов по числу слабых карт, а не полная перегенерация колоды.
 * Возвращает обновления для применения в БД; вердикт пересчитывается детерминированно.
 */
export async function runDoctor(
  cards: Card[],
  opts: { systemPrompt?: string; onProgress?: ProgressFn } = {}
): Promise<DoctorUpdate[]> {
  const weak = weakLengthCards(cards);
  const concurrency = genConcurrency();
  const updates: DoctorUpdate[] = [];
  let done = 0;
  opts.onProgress?.(0, weak.length, `Доводка слабых: 0/${weak.length}`);
  await mapWithLimit(weak, concurrency, async (c) => {
    const raw: RawCard = {
      patternIndex: c.cardNumber,
      name: c.name,
      description: c.description,
      task: c.task,
      painScore: c.qualityVerdict?.painScore,
    };
    const better = await fixCardLength(raw, opts.systemPrompt);
    const constraintIssues = checkConstraints(better.name, better.description, better.task);
    const painScore = c.qualityVerdict?.painScore ?? 0;
    updates.push({
      cardId: c.id,
      name: better.name,
      description: better.description,
      task: better.task,
      qualityVerdict: {
        ...c.qualityVerdict,
        passed: constraintIssues.length === 0 && painScore >= PAIN_THRESHOLD,
        painScore,
        constraintIssues,
      },
    });
    done += 1;
    opts.onProgress?.(done, weak.length, `Доводка слабых: ${done}/${weak.length}`);
  });
  return updates;
}
