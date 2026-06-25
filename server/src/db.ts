import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Card, Case, Deck, DeckProfile, DeckStatus, StageKey } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'carty.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS decks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  theme         TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'draft',
  profile       TEXT,
  profile_frozen INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id      INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT '',
  problem_type TEXT NOT NULL DEFAULT '',
  matrix_cell  TEXT NOT NULL DEFAULT '',
  score        INTEGER,
  score_breakdown TEXT,
  grp          TEXT,
  status       TEXT,
  analytics    TEXT
);

CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id       INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  axis          TEXT NOT NULL,
  source_case_id INTEGER,
  card_number   INTEGER NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  pattern_name  TEXT NOT NULL,
  description   TEXT NOT NULL,
  task          TEXT NOT NULL,
  extra_material_type TEXT NOT NULL,
  quality_verdict TEXT
);
`);

// Миграция: оверрайды промптов. Добавляем колонку только если её ещё нет —
// существующую БД с данными не ломаем (ALTER ADD COLUMN с NULL безопасен).
{
  const cols = db.prepare(`PRAGMA table_info(decks)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'prompt_overrides')) {
    db.exec(`ALTER TABLE decks ADD COLUMN prompt_overrides TEXT`);
  }
}

// Миграция: промпт изображения карты (Стадия 4). NULL-колонка безопасна для старых БД.
{
  const cols = db.prepare(`PRAGMA table_info(cards)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === 'image_prompt')) {
    db.exec(`ALTER TABLE cards ADD COLUMN image_prompt TEXT`);
  }
  // Миграция: метаданные картинки карты (Стадия 5): { kind, ext, credit?, pageUrl?, at }.
  if (!cols.some((c) => c.name === 'image_meta')) {
    db.exec(`ALTER TABLE cards ADD COLUMN image_meta TEXT`);
  }
  // Миграция: отдельный стоковый слот (Стадия 5): запрос Pexels + мета сырого фото.
  if (!cols.some((c) => c.name === 'stock_query')) {
    db.exec(`ALTER TABLE cards ADD COLUMN stock_query TEXT`);
  }
  if (!cols.some((c) => c.name === 'stock_meta')) {
    db.exec(`ALTER TABLE cards ADD COLUMN stock_meta TEXT`);
  }
}

function rowToDeck(row: any): Deck {
  return {
    id: Number(row.id),
    theme: row.theme,
    notes: row.notes,
    status: row.status as DeckStatus,
    profile: row.profile ? (JSON.parse(row.profile) as DeckProfile) : null,
    promptOverrides: row.prompt_overrides ? JSON.parse(row.prompt_overrides) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDeck(theme: string, notes: string): Deck {
  const info = db.prepare(`INSERT INTO decks (theme, notes) VALUES (?, ?)`).run(theme, notes);
  return getDeck(Number(info.lastInsertRowid))!;
}

export function listDecks(): Deck[] {
  return (db.prepare(`SELECT * FROM decks ORDER BY id DESC`).all() as any[]).map(rowToDeck);
}

export function getDeck(id: number): Deck | null {
  const row = db.prepare(`SELECT * FROM decks WHERE id = ?`).get(id);
  return row ? rowToDeck(row) : null;
}

export function saveProfile(id: number, profile: DeckProfile, status: DeckStatus): void {
  db.prepare(
    `UPDATE decks SET profile = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(profile), status, id);
}

/**
 * Сохраняет/сбрасывает оверрайд system-промпта стадии.
 * Пустая строка = сброс к дефолту (ключ удаляется).
 */
export function savePromptOverride(id: number, stage: StageKey, system: string): void {
  const deck = getDeck(id);
  if (!deck) return;
  const overrides = { ...deck.promptOverrides };
  if (system.trim()) overrides[stage] = { system };
  else delete overrides[stage];
  db.prepare(
    `UPDATE decks SET prompt_overrides = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(overrides), id);
}

export function setStatus(id: number, status: DeckStatus): void {
  db.prepare(`UPDATE decks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
}

// --- Кейсы (Стадия 1+) ---

/** Поля сырого кейса при вставке (до валидации/скоринга). */
export interface RawCaseInput {
  title: string;
  summary: string;
  source: string;
  problemType: string;
  matrixCell: string; // "M1×C2"
}

function rowToCase(r: any): Case {
  return {
    id: Number(r.id),
    deckId: Number(r.deck_id),
    title: r.title,
    summary: r.summary,
    source: r.source,
    problemType: r.problem_type,
    matrixCell: r.matrix_cell,
    score: r.score ?? undefined,
    scoreBreakdown: r.score_breakdown ? JSON.parse(r.score_breakdown) : undefined,
    group: (r.grp ?? null) as Case['group'],
    status: (r.status ?? undefined) as Case['status'],
    analytics: r.analytics ?? undefined,
  };
}

/** Идемпотентно заменяет набор кейсов колоды (для повторного запуска Стадии 1). */
export function replaceCases(deckId: number, cases: RawCaseInput[]): void {
  const ins = db.prepare(
    `INSERT INTO cases (deck_id, title, summary, source, problem_type, matrix_cell)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM cases WHERE deck_id = ?`).run(deckId);
    for (const c of cases) {
      ins.run(deckId, c.title, c.summary, c.source, c.problemType, c.matrixCell);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listCases(deckId: number): Case[] {
  return (db.prepare(`SELECT * FROM cases WHERE deck_id = ? ORDER BY id`).all(deckId) as any[]).map(
    rowToCase
  );
}

/** Результат валидации одного кейса (Стадия 2). */
export interface CaseValidation {
  score: number;
  scoreBreakdown: Record<string, number>;
  group: 'Я' | 'МЫ' | null;
  status: 'active' | 'duplicate' | 'rejected';
  analytics: string;
}

export function updateCaseValidation(id: number, v: CaseValidation): void {
  db.prepare(
    `UPDATE cases SET score = ?, score_breakdown = ?, grp = ?, status = ?, analytics = ? WHERE id = ?`
  ).run(v.score, JSON.stringify(v.scoreBreakdown), v.group, v.status, v.analytics, id);
}

// --- Карты (Стадия 3) ---

/** Поля карты при вставке (без id/deckId — их проставляет БД/контекст). */
export interface RawCardInput {
  axis: 'Я' | 'МЫ';
  sourceCaseId: number | null;
  cardNumber: number;
  name: string;
  category: string;
  patternName: string;
  description: string;
  task: string;
  extraMaterialType: 'Генерация' | 'Трансформация';
  qualityVerdict?: Card['qualityVerdict'];
}

function rowToCard(r: any): Card {
  return {
    id: Number(r.id),
    deckId: Number(r.deck_id),
    axis: r.axis as Card['axis'],
    sourceCaseId: r.source_case_id != null ? Number(r.source_case_id) : null,
    cardNumber: Number(r.card_number),
    name: r.name,
    category: r.category,
    patternName: r.pattern_name,
    description: r.description,
    task: r.task,
    extraMaterialType: r.extra_material_type as Card['extraMaterialType'],
    qualityVerdict: r.quality_verdict ? JSON.parse(r.quality_verdict) : undefined,
    imagePrompt: r.image_prompt ?? undefined,
    imageMeta: r.image_meta ? JSON.parse(r.image_meta) : undefined,
    stockQuery: r.stock_query ?? undefined,
    stockMeta: r.stock_meta ? JSON.parse(r.stock_meta) : undefined,
  };
}

/** Идемпотентно заменяет набор карт колоды (для повторного запуска Стадии 3). */
export function replaceCards(deckId: number, cards: RawCardInput[]): void {
  const ins = db.prepare(
    `INSERT INTO cards
       (deck_id, axis, source_case_id, card_number, name, category, pattern_name,
        description, task, extra_material_type, quality_verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM cards WHERE deck_id = ?`).run(deckId);
    for (const c of cards) {
      ins.run(
        deckId,
        c.axis,
        c.sourceCaseId,
        c.cardNumber,
        c.name,
        c.category,
        c.patternName,
        c.description,
        c.task,
        c.extraMaterialType,
        c.qualityVerdict ? JSON.stringify(c.qualityVerdict) : null
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listCards(deckId: number): Card[] {
  return (
    db
      .prepare(`SELECT * FROM cards WHERE deck_id = ? ORDER BY axis DESC, card_number`)
      .all(deckId) as any[]
  ).map(rowToCard);
}

/** Одна карта по id (или null). */
export function getCard(cardId: number): Card | null {
  const r = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(cardId) as any;
  return r ? rowToCard(r) : null;
}

/** Точечное обновление текстовых полей карты + пересчитанный вердикт (ручная правка). */
export function updateCardFields(
  cardId: number,
  fields: { name: string; description: string; task: string },
  verdict: Card['qualityVerdict']
): void {
  db.prepare(
    `UPDATE cards SET name = ?, description = ?, task = ?, quality_verdict = ? WHERE id = ?`
  ).run(
    fields.name,
    fields.description,
    fields.task,
    verdict ? JSON.stringify(verdict) : null,
    cardId
  );
}

/** Обновляет промпт изображения карты (Стадия 4 / ручная правка). */
export function setCardImagePrompt(cardId: number, prompt: string): void {
  db.prepare(`UPDATE cards SET image_prompt = ? WHERE id = ?`).run(prompt, cardId);
}

/** Сохраняет метаданные готовой картинки карты (Стадия 5). */
export function setCardImageMeta(cardId: number, meta: Card['imageMeta']): void {
  db.prepare(`UPDATE cards SET image_meta = ? WHERE id = ?`).run(
    meta ? JSON.stringify(meta) : null,
    cardId
  );
}

/** Обновляет стоковый поисковый запрос карты (Стадия 4 / ручная правка). */
export function setCardStockQuery(cardId: number, query: string): void {
  db.prepare(`UPDATE cards SET stock_query = ? WHERE id = ?`).run(query, cardId);
}

/** Сохраняет метаданные сырого стокового фото карты (слот stock). */
export function setCardStockMeta(cardId: number, meta: Card['stockMeta']): void {
  db.prepare(`UPDATE cards SET stock_meta = ? WHERE id = ?`).run(
    meta ? JSON.stringify(meta) : null,
    cardId
  );
}
