import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import {
  createDeck,
  listDecks,
  getDeck,
  saveProfile,
  savePromptOverride,
  setStatus,
  replaceCases,
  listCases,
  updateCaseValidation,
  replaceCards,
  listCards,
  getCard,
  updateCardFields,
  setCardImagePrompt,
  setCardImageMeta,
  setCardStockQuery,
  setCardStockMeta,
} from './db.js';
import { runImagePrompts } from './stages/imager.js';
import { produceCardImage, runImageBatch, type ImageAction } from './stages/mediaStage.js';
import {
  isGenerateEnabled,
  isStockEnabled,
  isStylizeEnabled,
} from './media.js';
import { saveImage, readImage, removeImage } from './imagestore.js';
import { runProfiler, PROFILER_STAGE } from './stages/profiler.js';
import { runSourcer, SOURCER_STAGE } from './stages/sourcer.js';
import { runValidator, VALIDATOR_STAGE } from './stages/validator.js';
import {
  runGenerator,
  runDoctor,
  weakLengthCards,
  GENERATOR_STAGE,
  checkConstraints,
  PAIN_THRESHOLD,
} from './stages/generator.js';
import { startJob, getJob, isRunning } from './jobs.js';
import { CONTENT_TYPES, RAYS, CARD_CONSTRAINTS, DEFAULT_QUALITY_TARGETS } from './framework.js';
import type { DeckProfile, StageKey } from './types.js';

/** Реестр стадий конвейера — для эндпойнтов промптов. */
const STAGES = [PROFILER_STAGE, SOURCER_STAGE, VALIDATOR_STAGE, GENERATOR_STAGE] as const;
const STAGE_KEYS = STAGES.map((s) => s.key) as StageKey[];

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

/** Фикс-каркас — отдаём фронту, чтобы редактор показывал оси/паттерны. */
app.get('/api/framework', async () => ({
  contentTypes: CONTENT_TYPES,
  rays: RAYS,
  constraints: CARD_CONSTRAINTS,
  qualityTargets: DEFAULT_QUALITY_TARGETS,
}));

app.get('/api/decks', async () => listDecks());

app.post('/api/decks', async (req, reply) => {
  const { theme, notes } = (req.body ?? {}) as { theme?: string; notes?: string };
  if (!theme || !theme.trim()) {
    return reply.code(400).send({ error: 'theme обязателен' });
  }
  return createDeck(theme.trim(), (notes ?? '').trim());
});

app.get('/api/decks/:id', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  return deck;
});

/** Стадия 0: запустить Профайлер (фоном) -> профиль. */
app.post('/api/decks/:id/profile', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const job = startJob(id, 'profiler', 1, async (onProgress) => {
    const profile = await runProfiler(deck.theme, deck.notes, {
      systemPrompt: deck.promptOverrides.profiler?.system,
      onProgress,
    });
    saveProfile(id, profile, 'profiled');
  });
  return reply.code(202).send({ job });
});

/** Текущая (или последняя) фоновая задача стадии для колоды; null — если задач не было. */
app.get('/api/decks/:id/job', async (req) => {
  const id = Number((req.params as any).id);
  return getJob(id);
});

/** Ревизия человеком: сохранить отредактированный профиль. */
app.put('/api/decks/:id/profile', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  const profile = (req.body as any)?.profile as DeckProfile | undefined;
  if (!profile) return reply.code(400).send({ error: 'нет profile в теле' });
  saveProfile(id, profile, 'profiled');
  return getDeck(id);
});

// --- Промпты стадий (просмотр и редактирование system-промптов) ---

/** Реальные промпты стадий для колоды: дефолт + текущий (с оверрайдом) + пример user. */
app.get('/api/decks/:id/prompts', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  const p = deck.profile;
  const cases = p ? listCases(id) : [];
  return STAGES.map((s) => {
    let userExample = '(пример появится после генерации ядра)';
    if (s.key === 'profiler') userExample = s.buildUserExample(deck.theme, deck.notes);
    else if (p && s.key === 'sourcer') userExample = s.buildUserExample(p);
    else if (p && s.key === 'validator') userExample = s.buildUserExample(p, cases);
    else if (p && s.key === 'generator') userExample = s.buildUserExample(p);
    return {
      key: s.key,
      title: s.title,
      defaultSystem: s.defaultSystem,
      system: deck.promptOverrides[s.key]?.system ?? s.defaultSystem,
      userExample,
    };
  });
});

/** Сохранить/сбросить оверрайд system-промпта стадии (пустая строка = сброс). */
app.put('/api/decks/:id/prompts/:stage', async (req, reply) => {
  const id = Number((req.params as any).id);
  const stage = (req.params as any).stage as StageKey;
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (!STAGE_KEYS.includes(stage)) return reply.code(400).send({ error: 'неизвестная стадия' });
  const system = ((req.body as any)?.system ?? '') as string;
  savePromptOverride(id, stage, system);
  return getDeck(id);
});

// --- Стадия 1: источник кейсов ---

/** Список кейсов колоды. */
app.get('/api/decks/:id/cases', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  return listCases(id);
});

/** Запустить Стадию 1 (фоном): собрать банк кейсов по замороженной матрице. */
app.post('/api/decks/:id/cases', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (!deck.profile) return reply.code(409).send({ error: 'профиль ещё не сгенерирован' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const profile = deck.profile;
  const job = startJob(id, 'sourcer', profile.functionalBlocks.length, async (onProgress) => {
    const cases = await runSourcer(profile, {
      systemPrompt: deck.promptOverrides.sourcer?.system,
      onProgress,
    });
    replaceCases(id, cases);
    setStatus(id, 'sourced');
  });
  return reply.code(202).send({ job });
});

/** Запустить Стадию 2 (фоном): валидация/скоринг/типизация собранных кейсов. */
app.post('/api/decks/:id/validate', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (!deck.profile) return reply.code(409).send({ error: 'профиль ещё не сгенерирован' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const profile = deck.profile;
  const cases = listCases(id);
  if (cases.length === 0)
    return reply.code(409).send({ error: 'нет кейсов — сначала запустите Стадию 1' });
  const job = startJob(id, 'validator', 1 + Math.ceil(cases.length / 10), async (onProgress) => {
    const { results } = await runValidator(profile, cases, {
      systemPrompt: deck.promptOverrides.validator?.system,
      onProgress,
    });
    for (const r of results) updateCaseValidation(r.id, r.validation);
    setStatus(id, 'validated');
  });
  return reply.code(202).send({ job });
});

// --- Стадия 3: генерация карт ---

/** Список карт колоды. */
app.get('/api/decks/:id/cards', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  return listCards(id);
});

/** Ручная правка карты: обновляет name/description/task и пересчитывает вердикт (детерминированно). */
app.patch('/api/decks/:id/cards/:cardId', async (req, reply) => {
  const id = Number((req.params as any).id);
  const cardId = Number((req.params as any).cardId);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'колода не найдена' });
  const card = getCard(cardId);
  if (!card || card.deckId !== id) return reply.code(404).send({ error: 'карта не найдена' });

  const body = (req.body ?? {}) as {
    name?: string;
    description?: string;
    task?: string;
    imagePrompt?: string;
    stockQuery?: string;
  };
  const name = (body.name ?? card.name).trim();
  const description = (body.description ?? card.description).trim();
  const task = (body.task ?? card.task).trim();

  // Пересчёт вердикта теми же правилами, что и при генерации: лимиты + порог боли.
  const constraintIssues = checkConstraints(name, description, task);
  const painScore = card.qualityVerdict?.painScore ?? 0;
  const verdict = {
    ...card.qualityVerdict,
    passed: constraintIssues.length === 0 && painScore >= PAIN_THRESHOLD,
    painScore,
    constraintIssues,
  };
  updateCardFields(cardId, { name, description, task }, verdict);
  // Промпт изображения и стоковый запрос (Стадия 4) — отдельные поля, на вердикт не влияют.
  if (body.imagePrompt !== undefined) setCardImagePrompt(cardId, body.imagePrompt.trim());
  if (body.stockQuery !== undefined) setCardStockQuery(cardId, body.stockQuery.trim());
  return getCard(cardId);
});

/** Стадия 4 (фоном): промпты изображений + стоковые запросы для всех карт с контентом. */
app.post('/api/decks/:id/cards/image-prompts', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const cards = listCards(id);
  const filled = cards.filter((c) => !!c.name?.trim());
  if (filled.length === 0)
    return reply.code(409).send({ error: 'нет карт с контентом — сначала сгенерируйте карты' });
  // total = число категорий с контентом (батч на категорию).
  const groups = new Set(filled.map((c) => `${c.axis}|${c.category}`));
  const job = startJob(id, 'generator', groups.size, async (onProgress) => {
    const updates = await runImagePrompts(cards, { onProgress });
    for (const u of updates) {
      setCardImagePrompt(u.cardId, u.imagePrompt);
      setCardStockQuery(u.cardId, u.stockQuery);
    }
  });
  return reply.code(202).send({ job });
});

// --- Стадия 5: картинки карт (сток / итог) ---

/** Доступность медиа-веток — фронт по этому показывает/прячет кнопки. */
app.get('/api/media/status', async () => ({
  generate: isGenerateEnabled(), // Cloudflare FLUX (text2img)
  stock: isStockEnabled(), // Pexels (поиск фото)
  stylize: isStylizeEnabled(), // Cloudflare img2img (стилизация стока)
}));

/** Отдаёт файл итоговой картинки карты (слот final). */
app.get('/api/decks/:id/cards/:cardId/image', async (req, reply) => {
  const id = Number((req.params as any).id);
  const cardId = Number((req.params as any).cardId);
  const card = getCard(cardId);
  if (!card || card.deckId !== id || !card.imageMeta) return reply.code(404).send({ error: 'нет картинки' });
  const bytes = readImage(cardId, 'final', card.imageMeta.ext);
  if (!bytes) return reply.code(404).send({ error: 'файл картинки не найден' });
  reply.header('Content-Type', card.imageMeta.ext === 'png' ? 'image/png' : 'image/jpeg');
  reply.header('Cache-Control', 'no-cache');
  return reply.send(bytes);
});

/** Отдаёт файл сырого стокового фото карты (слот stock). */
app.get('/api/decks/:id/cards/:cardId/image/stock', async (req, reply) => {
  const id = Number((req.params as any).id);
  const cardId = Number((req.params as any).cardId);
  const card = getCard(cardId);
  if (!card || card.deckId !== id || !card.stockMeta) return reply.code(404).send({ error: 'нет стокового фото' });
  const bytes = readImage(cardId, 'stock', card.stockMeta.ext);
  if (!bytes) return reply.code(404).send({ error: 'файл стокового фото не найден' });
  reply.header('Content-Type', card.stockMeta.ext === 'png' ? 'image/png' : 'image/jpeg');
  reply.header('Cache-Control', 'no-cache');
  return reply.send(bytes);
});

/** Производство картинки ОДНОЙ карты (синхронно). action: stock|stock-as-final|stylize|generate. */
app.post('/api/decks/:id/cards/:cardId/image', async (req, reply) => {
  const id = Number((req.params as any).id);
  const cardId = Number((req.params as any).cardId);
  const card = getCard(cardId);
  if (!card || card.deckId !== id) return reply.code(404).send({ error: 'карта не найдена' });
  const body = (req.body ?? {}) as { action?: ImageAction };
  const action: ImageAction =
    body.action === 'stock' || body.action === 'stock-as-final' || body.action === 'stylize'
      ? body.action
      : 'generate';
  try {
    const out = await produceCardImage(card, action);
    saveImage(cardId, out.slot, out.bytes, out.ext);
    if (out.slot === 'stock') setCardStockMeta(cardId, out.stockMeta);
    else setCardImageMeta(cardId, out.imageMeta);
    return getCard(cardId);
  } catch (e) {
    return reply.code(502).send({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Удаляет картинку карты: ?slot=stock|final (по умолчанию final). */
app.delete('/api/decks/:id/cards/:cardId/image', async (req, reply) => {
  const id = Number((req.params as any).id);
  const cardId = Number((req.params as any).cardId);
  const card = getCard(cardId);
  if (!card || card.deckId !== id) return reply.code(404).send({ error: 'карта не найдена' });
  const slot = (req.query as any)?.slot === 'stock' ? 'stock' : 'final';
  removeImage(cardId, slot);
  if (slot === 'stock') setCardStockMeta(cardId, undefined);
  else setCardImageMeta(cardId, undefined);
  return getCard(cardId);
});

/** Стадия 5 пакетом (фоном). action: stock|stock-as-final|stylize|generate. */
app.post('/api/decks/:id/cards/images', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const body = (req.body ?? {}) as { action?: ImageAction };
  const action: ImageAction =
    body.action === 'stock' || body.action === 'stock-as-final' || body.action === 'stylize'
      ? body.action
      : 'generate';
  if (action === 'generate' && !isGenerateEnabled())
    return reply.code(409).send({ error: 'генерация не настроена (нужны ключи Cloudflare)' });
  if (action === 'stock' && !isStockEnabled())
    return reply.code(409).send({ error: 'сток не настроен (нужен PEXELS_API_KEY)' });
  if (action === 'stylize' && !isStylizeEnabled())
    return reply.code(409).send({ error: 'стилизация не настроена (нужны ключи Cloudflare)' });

  const cards = listCards(id);
  const hasTargets = cards.some((c) => {
    if (!c.name?.trim()) return false;
    if (action === 'stock') return true;
    if (action === 'generate' || action === 'stylize') return !!c.imagePrompt?.trim();
    return true;
  });
  if (!hasTargets) return reply.code(409).send({ error: 'нет подходящих карт — сначала Стадия 4' });

  const total = cards.filter((c) => !!c.name?.trim()).length;
  const job = startJob(id, 'generator', total, async (onProgress) => {
    const results = await runImageBatch(cards, action, { onProgress });
    for (const r of results) {
      if (!r.output) continue;
      saveImage(r.cardId, r.output.slot, r.output.bytes, r.output.ext);
      if (r.output.slot === 'stock') setCardStockMeta(r.cardId, r.output.stockMeta);
      else setCardImageMeta(r.cardId, r.output.imageMeta);
    }
  });
  return reply.code(202).send({ job });
});

/** Точечная доводка длины ТОЛЬКО слабых карт (фоном) — без полной перегенерации. */
app.post('/api/decks/:id/cards/doctor', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const cards = listCards(id);
  const weak = weakLengthCards(cards);
  if (weak.length === 0)
    return reply.code(409).send({ error: 'нет слабых карт с отклонением длины — доводить нечего' });
  const job = startJob(id, 'generator', weak.length, async (onProgress) => {
    const updates = await runDoctor(cards, {
      systemPrompt: deck.promptOverrides.generator?.system,
      onProgress,
    });
    for (const u of updates) {
      updateCardFields(u.cardId, { name: u.name, description: u.description, task: u.task }, u.qualityVerdict);
    }
  });
  return reply.code(202).send({ job });
});

/** Запустить Стадию 3 (фоном): сгенерировать 36+36 карт из провалидированных кейсов. */
app.post('/api/decks/:id/cards/generate', async (req, reply) => {
  const id = Number((req.params as any).id);
  const deck = getDeck(id);
  if (!deck) return reply.code(404).send({ error: 'не найдено' });
  if (!deck.profile) return reply.code(409).send({ error: 'профиль ещё не сгенерирован' });
  if (isRunning(id)) return reply.code(409).send({ error: 'для этой колоды уже выполняется стадия' });
  const profile = deck.profile;
  const cases = listCases(id);
  if (!cases.some((c) => c.status === 'active'))
    return reply.code(409).send({ error: 'нет активных кейсов — сначала пройдите Стадию 2 (валидация)' });
  // 12 категорий каркаса (6 типов «Я» + 6 лучей «МЫ») — столько LLM-вызовов.
  const job = startJob(id, 'generator', 12, async (onProgress) => {
    const { cards } = await runGenerator(profile, cases, {
      systemPrompt: deck.promptOverrides.generator?.system,
      onProgress,
    });
    replaceCards(id, cards);
    setStatus(id, 'cards');
  });
  return reply.code(202).send({ job });
});

const port = Number(process.env.PORT) || 8787;
app.listen({ port, host: '0.0.0.0' }).then(() => {
  app.log.info(`Carty server on http://localhost:${port}`);
});
