/**
 * Стадия 1 — Источник кейсов.
 *
 * Вход: замороженный DeckProfile (матрица M×C — контракт).
 * Выход: банк сырых (невалидированных) кейсов, привязанных к ячейкам матрицы.
 *
 * Методология «МАЯК» (раздел 10.3): по каждой ячейке матрицы ищутся реальные
 * проблемные кейсы организации этого типа.
 *
 * РЕЖИМЫ РАБОТЫ (см. search.ts):
 *  - Поиск ВКЛЮЧЁН (SEARCH_PROVIDER≠none): для каждой ячейки M×C выполняется реальный
 *    веб-поиск (Tavily). Найденные результаты (заголовок/URL/сниппет) передаются модели,
 *    и она ИЗВЛЕКАЕТ из них проблемные кейсы, проставляя в source НАСТОЯЩУЮ ссылку.
 *  - Поиск ВЫКЛЮЧЕН либо ничего не найдено: откат на LLM-синтез реалистичных кейсов
 *    (как в исходной системе), source помечается как «требует проверки».
 *
 * Шаг поиска изолирован в `sourceCasesForBlock` — провайдера можно менять, не трогая
 * остальной конвейер.
 */

import { chatJSON } from '../llm.js';
import { webSearch, isSearchEnabled, type SearchResult } from '../search.js';
import type { DeckProfile } from '../types.js';
import type { RawCaseInput } from '../db.js';
import type { ProgressFn } from '../jobs.js';

const SYSTEM = `Ты — отраслевой аналитик-исследователь. Собираешь банк РЕАЛЬНЫХ проблемных
кейсов организаций заданного типа — ситуаций, где у команды «болит»: конфликт,
дефицит времени/ресурсов, ошибка процесса, риск.

ПРИНЦИПЫ:
- Конкретика отрасли: реальные роли, процессы, цифры, а не общие слова.
- В каждом кейсе должен быть КОНФЛИКТ и ДЕФИЦИТ ВРЕМЕНИ — то, что заставит участника
  сказать «это про нас!».
- Когда даны результаты веб-поиска — ОПИРАЙСЯ на них: бери реальную ситуацию из
  результата и в поле "source" указывай ТОЧНЫЙ URL того результата, на котором кейс основан.
  НЕ придумывай ссылки, которых нет в выдаче.
- Когда результатов поиска нет — синтезируй типовую отраслевую ситуацию, а в "source"
  укажи тип источника (без выдуманных URL).
- Соблюдай стоп-лист: указанные темы запрещены полностью.

ФОРМАТ ВЫВОДА: строго один JSON-объект, без markdown-обёрток и текста вокруг.`;

interface RawCase {
  c: string; // id кластера C1..C5
  title: string;
  summary: string;
  source: string;
  problemType: string;
}

interface BlockResult {
  cases: RawCase[];
}

/** Сколько кейсов на ячейку матрицы (M×C). */
const DEFAULT_CASES_PER_CELL = 2;
/** Сколько результатов поиска запрашивать на ячейку. */
const RESULTS_PER_CELL = 4;

/** Поисковый запрос для одной ячейки M×C (на русском — для отраслевой релевантности). */
function buildSearchQuery(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  cluster: DeckProfile['stakeholderClusters'][number]
): string {
  const seed = profile.matrix.find((x) => x.m === block.id && x.c === cluster.id)?.seedThemes ?? [];
  const parts = [profile.theme, block.name, cluster.name, ...seed];
  return `${parts.filter(Boolean).join(' ')} проблемы реальные случаи`;
}

function buildBlockPrompt(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  casesPerCell: number,
  searchByCluster?: Map<string, SearchResult[]>
): string {
  const clusters = profile.stakeholderClusters
    .map((c) => {
      const seed = profile.matrix.find((x) => x.m === block.id && x.c === c.id)?.seedThemes ?? [];
      const head = `  - ${c.id} «${c.name}» (${c.question})${
        seed.length ? `; затравочные темы: ${seed.join(', ')}` : ''
      }`;
      const results = searchByCluster?.get(c.id) ?? [];
      if (!results.length) return head;
      const found = results
        .map((r, i) => `      [${i + 1}] ${r.title}\n          URL: ${r.url}\n          ${r.snippet.slice(0, 300)}`)
        .join('\n');
      return `${head}\n    Результаты веб-поиска (используй их и ставь точный URL в source):\n${found}`;
    })
    .join('\n');

  const grounded = !!searchByCluster && searchByCluster.size > 0;
  const sourceHint = grounded
    ? `"source": "ТОЧНЫЙ URL из результатов веб-поиска этого кластера, на котором основан кейс"`
    : `"source": "тип источника (без выдуманных ссылок)"`;
  const intro = grounded
    ? `Ниже по каждому кластеру даны РЕАЛЬНЫЕ результаты веб-поиска. Для КАЖДОГО кластера извлеки ${casesPerCell} проблемных кейса, опираясь на эти результаты, и в "source" поставь точный URL соответствующего результата.`
    : `Для КАЖДОГО кластера подбери ${casesPerCell} проблемных кейса (синтез типовых отраслевых ситуаций).`;

  return `ОБЛАСТЬ: ${profile.theme} — ${profile.audience.name}.
АУДИТОРИЯ: ${profile.audience.description}
БОЛИ АУДИТОРИИ: ${profile.painProfile}
${profile.terminologyNotes ? `ТЕРМИНОЛОГИЯ: ${profile.terminologyNotes}` : ''}

ФУНКЦИОНАЛЬНЫЙ БЛОК ${block.id} «${block.name}» (${block.focus}).
Кластеры стейкхолдеров (столбцы матрицы):
${clusters}

СТОП-ЛИСТ (запрещено): ${profile.tabooList.join('; ')}

${intro}
Всего кейсов: ${profile.stakeholderClusters.length * casesPerCell}.
Верни строго JSON:
{
  "cases": [
    {
      "c": "C1",
      "title": "короткое название кейса (до 80 симв.)",
      "summary": "2-4 предложения: что произошло, в чём конфликт, дефицит времени/ресурса",
      ${sourceHint},
      "problemType": "тип проблемы одним словом/фразой"
    }
  ]
}
Все "c" должны быть из списка кластеров выше.`;
}

function validateBlock(v: unknown): BlockResult {
  const p = v as BlockResult;
  if (!p || !Array.isArray(p.cases)) throw new Error('ожидался объект { cases: [...] }');
  for (const c of p.cases) {
    if (!c?.title || !c?.summary || !c?.c) throw new Error('у кейса нет c/title/summary');
  }
  return p;
}

/**
 * Шаг поиска по одному блоку матрицы.
 * 1) По каждому кластеру блока — реальный веб-поиск (если включён).
 * 2) LLM извлекает/синтезирует кейсы; при заземлении source = реальный URL из выдачи.
 */
async function sourceCasesForBlock(
  profile: DeckProfile,
  block: DeckProfile['functionalBlocks'][number],
  casesPerCell: number,
  systemPrompt?: string,
  onSearch?: (clusterName: string) => void
): Promise<RawCaseInput[]> {
  const validClusters = new Set(profile.stakeholderClusters.map((c) => c.id));

  // 1. Веб-поиск по ячейкам M×C блока.
  const searchByCluster = new Map<string, SearchResult[]>();
  const allowedUrls = new Set<string>();
  if (isSearchEnabled()) {
    for (const cl of profile.stakeholderClusters) {
      onSearch?.(cl.name);
      const results = await webSearch(buildSearchQuery(profile, block, cl), RESULTS_PER_CELL);
      if (results.length) {
        searchByCluster.set(cl.id, results);
        results.forEach((r) => allowedUrls.add(r.url));
      }
    }
  }
  const grounded = searchByCluster.size > 0;

  // 2. Извлечение/синтез кейсов моделью.
  const res = await chatJSON<BlockResult>(
    [
      { role: 'system', content: systemPrompt || SYSTEM },
      { role: 'user', content: buildBlockPrompt(profile, block, casesPerCell, searchByCluster) },
    ],
    { temperature: grounded ? 0.4 : 0.6, retries: 2, validate: validateBlock }
  );

  // 3. Нормализация source: при заземлении принимаем только реальные URL из выдачи.
  return res.cases
    .filter((c) => validClusters.has(c.c))
    .map((c) => {
      let source = (c.source || '').trim();
      if (grounded) {
        const isRealUrl = /^https?:\/\//i.test(source) && (allowedUrls.has(source) || allowedUrls.size === 0);
        if (!isRealUrl) {
          // Модель не сослалась на нашу выдачу — берём наиболее релевантный URL кластера, если есть.
          const fallbackUrl = searchByCluster.get(c.c)?.[0]?.url;
          source = fallbackUrl ?? (source || 'источник не подтверждён (требует проверки)');
        }
      } else {
        source = source || 'обобщённый отраслевой кейс (LLM, требует проверки)';
      }
      return {
        title: c.title.trim(),
        summary: c.summary.trim(),
        source,
        problemType: (c.problemType || '').trim(),
        matrixCell: `${block.id}×${c.c}`,
      };
    });
}

/** Метаданные стадии для UI-панели промптов (пример — по первому блоку матрицы). */
export const SOURCER_STAGE = {
  key: 'sourcer' as const,
  title: 'Стадия 1 · Источник кейсов',
  defaultSystem: SYSTEM,
  buildUserExample: (profile: DeckProfile) =>
    profile.functionalBlocks[0]
      ? buildBlockPrompt(profile, profile.functionalBlocks[0], DEFAULT_CASES_PER_CELL)
      : '(пример появится после генерации ядра)',
};

/** Запускает Стадию 1: проходит по функциональным блокам матрицы и собирает банк кейсов. */
export async function runSourcer(
  profile: DeckProfile,
  opts: { casesPerCell?: number; systemPrompt?: string; onProgress?: ProgressFn } = {}
): Promise<RawCaseInput[]> {
  const casesPerCell = opts.casesPerCell ?? DEFAULT_CASES_PER_CELL;
  const all: RawCaseInput[] = [];
  const total = profile.functionalBlocks.length;
  const mode = isSearchEnabled() ? 'веб-поиск' : 'синтез';

  // Последовательно по блокам — щадим бесплатный фритир (меньше параллельных лимитов).
  for (let i = 0; i < total; i++) {
    const block = profile.functionalBlocks[i];
    opts.onProgress?.(i, total, `Блок ${block.id} «${block.name}» (${mode})`);
    const cases = await sourceCasesForBlock(
      profile,
      block,
      casesPerCell,
      opts.systemPrompt,
      (clusterName) => opts.onProgress?.(i, total, `Блок ${block.id}: поиск «${clusterName}»`)
    );
    all.push(...cases);
  }

  if (all.length === 0) throw new Error('не удалось собрать ни одного кейса');
  return all;
}
