import { useEffect, useMemo, useState } from 'react';
import type { Card } from './types';
import { CheckIcon, AlertIcon, Button } from './ui';
import { api, type MediaStatus, type ImageAction } from './api';

/** Диапазоны длины полей карты (символы) — синхронны с CARD_CONSTRAINTS на сервере. */
const LIMITS = {
  name: { min: 15, max: 20 },
  description: { min: 300, max: 350 },
  task: { min: 180, max: 220 },
} as const;

function VerdictBadge({ verdict }: { verdict: Card['qualityVerdict'] }) {
  if (!verdict) return null;
  const { passed, painScore } = verdict;
  return (
    <span
      className={`text-[10px] font-extrabold rounded-full px-2.5 py-0.5 ring-1 ring-inset flex items-center gap-1 ${
        passed
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/50 shadow-sm'
          : 'bg-amber-50 text-amber-700 ring-amber-200/40 shadow-sm'
      }`}
      title={passed ? 'Успешно прошла верификацию методиста' : 'Требует ручной доработки'}
    >
      {passed ? (
        <CheckIcon className="w-2.5 h-2.5 text-emerald-600" />
      ) : (
        <AlertIcon className="w-2.5 h-2.5 text-amber-600" />
      )}
      <span>{painScore ?? 0}</span>
    </span>
  );
}

function TaskTypeBadge({ type }: { type: Card['extraMaterialType'] }) {
  const isGen = type === 'Генерация';
  return (
    <span className={`text-[9px] font-bold rounded-lg px-2 py-0.5 uppercase tracking-wider ${
      isGen 
        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200/30' 
        : 'bg-purple-50 text-purple-700 border border-purple-200/30'
    }`}>
      {type}
    </span>
  );
}

function AxisBadge({ axis }: { axis: 'Я' | 'МЫ' }) {
  return (
    <span
      className={`text-[10px] font-bold rounded-lg px-2 py-0.5 ring-1 ring-inset ${
        axis === 'Я'
          ? 'bg-beam-50 text-beam-700 ring-beam-200/50'
          : 'bg-sea-50 text-sea-700 ring-sea-200/50'
      }`}
    >
      {axis}
    </span>
  );
}

/** Поле-textarea с живым счётчиком символов и подсветкой попадания в диапазон. */
function FieldEditor({
  value,
  min,
  max,
  rows,
  onChange,
}: {
  value: string;
  min: number;
  max: number;
  rows: number;
  onChange: (v: string) => void;
}) {
  const len = [...value].length;
  const ok = len >= min && len <= max;
  return (
    <div>
      <textarea
        className="w-full text-[11px] border border-slate-200 rounded-lg p-2 bg-white outline-none transition-all resize-y focus:border-beam-500 focus:ring-2 focus:ring-beam-100 leading-relaxed"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div
        className={`text-[10px] font-bold mt-0.5 tabular-nums ${
          ok ? 'text-emerald-600' : 'text-amber-600'
        }`}
      >
        {len} / {min}–{max} симв. {ok ? '✓' : ''}
      </div>
    </div>
  );
}

/** Строка таблицы карт: просмотр + инлайн-редактирование name/description/task. */
function EditableCardRow({
  card,
  deckId,
  media,
  onSave,
  onMakeImage,
  onDropImage,
}: {
  card: Card;
  deckId: number;
  media: MediaStatus;
  onSave: (fields: {
    name: string;
    description: string;
    task: string;
    imagePrompt: string;
    stockQuery: string;
  }) => Promise<void>;
  onMakeImage?: (cardId: number, action: ImageAction) => Promise<void>;
  onDropImage?: (cardId: number, slot: 'stock' | 'final') => Promise<void>;
}) {
  const v = card.qualityVerdict;
  const weak = v && !v.passed;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: card.name,
    description: card.description,
    task: card.task,
    imagePrompt: card.imagePrompt ?? '',
    stockQuery: card.stockQuery ?? '',
  });

  // Пока не редактируем — держим черновик в синхроне с приходящей картой.
  useEffect(() => {
    if (!editing)
      setDraft({
        name: card.name,
        description: card.description,
        task: card.task,
        imagePrompt: card.imagePrompt ?? '',
        stockQuery: card.stockQuery ?? '',
      });
  }, [card, editing]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: draft.name.trim(),
        description: draft.description.trim(),
        task: draft.task.trim(),
        imagePrompt: draft.imagePrompt.trim(),
        stockQuery: draft.stockQuery.trim(),
      });
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Производство картинки этой карты по действию.
  const [imgBusy, setImgBusy] = useState<'' | ImageAction | 'del-stock' | 'del-final'>('');
  const [imgErr, setImgErr] = useState<string | null>(null);
  async function makeImage(action: ImageAction) {
    if (!onMakeImage) return;
    setImgBusy(action);
    setImgErr(null);
    try {
      await onMakeImage(card.id, action);
    } catch (e) {
      setImgErr(e instanceof Error ? e.message : String(e));
    } finally {
      setImgBusy('');
    }
  }
  async function delImage(slot: 'stock' | 'final') {
    if (!onDropImage) return;
    setImgBusy(slot === 'stock' ? 'del-stock' : 'del-final');
    try {
      await onDropImage(card.id, slot);
    } finally {
      setImgBusy('');
    }
  }
  const busy = imgBusy !== '';

  return (
    <tr
      className={`border-t border-slate-100 align-top transition-colors ${
        editing ? 'bg-beam-50/30' : weak ? 'bg-amber-50/20 hover:bg-amber-50/40' : 'hover:bg-slate-50/70'
      }`}
    >
      <td className="p-2.5 text-right text-[11px] font-mono font-bold text-navy-400 tabular-nums">
        {String(card.cardNumber).padStart(2, '0')}
      </td>
      <td className="p-2.5">
        <AxisBadge axis={card.axis} />
      </td>
      <td className="p-2.5 text-[11px] text-navy-600 leading-snug">{card.category}</td>

      {/* Название */}
      <td className="p-2.5">
        {editing ? (
          <FieldEditor
            value={draft.name}
            min={LIMITS.name.min}
            max={LIMITS.name.max}
            rows={2}
            onChange={(name) => setDraft((d) => ({ ...d, name }))}
          />
        ) : card.name ? (
          <div className="text-[11px] font-bold text-navy-950 leading-snug">{card.name}</div>
        ) : (
          <span className="text-[11px] text-amber-600 italic">не сгенерирована</span>
        )}
      </td>

      {/* Описание */}
      <td className="p-2.5 text-[11px] text-navy-600 leading-relaxed">
        {editing ? (
          <FieldEditor
            value={draft.description}
            min={LIMITS.description.min}
            max={LIMITS.description.max}
            rows={6}
            onChange={(description) => setDraft((d) => ({ ...d, description }))}
          />
        ) : (
          card.description || <span className="text-navy-300">—</span>
        )}
      </td>

      {/* Задание */}
      <td className="p-2.5 text-[11px] text-navy-700 leading-relaxed">
        {editing ? (
          <FieldEditor
            value={draft.task}
            min={LIMITS.task.min}
            max={LIMITS.task.max}
            rows={4}
            onChange={(task) => setDraft((d) => ({ ...d, task }))}
          />
        ) : (
          card.task || <span className="text-navy-300">—</span>
        )}
      </td>

      {/* Промпт изображения */}
      <td className="p-2.5">
        {editing ? (
          <textarea
            className="w-full text-[10px] font-mono border border-slate-200 rounded-lg p-2 bg-white outline-none transition-all resize-y focus:border-sea-500 focus:ring-2 focus:ring-sea-100 leading-relaxed"
            rows={5}
            placeholder="Промпт изображения (англ.)…"
            value={draft.imagePrompt}
            onChange={(e) => setDraft((d) => ({ ...d, imagePrompt: e.target.value }))}
          />
        ) : card.imagePrompt ? (
          <p className="text-[10px] font-mono text-navy-500 leading-relaxed">{card.imagePrompt}</p>
        ) : (
          <span className="text-navy-300">—</span>
        )}
      </td>

      {/* Стоковое фото (слот stock): запрос + превью + поиск */}
      <td className="p-2.5">
        <div className="flex flex-col items-start gap-1.5">
          {editing ? (
            <textarea
              className="w-full text-[10px] border border-slate-200 rounded-lg p-2 bg-white outline-none transition-all resize-y focus:border-navy-500 focus:ring-2 focus:ring-navy-100 leading-relaxed"
              rows={2}
              placeholder="Запрос для Pexels (англ.)…"
              value={draft.stockQuery}
              onChange={(e) => setDraft((d) => ({ ...d, stockQuery: e.target.value }))}
            />
          ) : (
            card.stockQuery && (
              <span className="text-[10px] text-navy-500 leading-tight" title="Поисковый запрос стока">
                «{card.stockQuery}»
              </span>
            )
          )}

          {card.stockMeta ? (
            <a
              href={api.cardStockUrl(deckId, card.id, card.stockMeta.at)}
              target="_blank"
              rel="noreferrer"
              title="Открыть стоковое фото"
            >
              <img
                src={api.cardStockUrl(deckId, card.id, card.stockMeta.at)}
                alt="сток"
                className="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-sm"
              />
            </a>
          ) : (
            <div className="w-20 h-20 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center text-[9px] text-navy-300 text-center px-1">
              нет фото
            </div>
          )}

          {card.stockMeta?.credit && (
            <span className="text-[9px] text-navy-400 leading-tight max-w-[80px] truncate" title={card.stockMeta.credit}>
              {card.stockMeta.credit}
            </span>
          )}

          {media.stock && card.imagePrompt && (
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => makeImage('stock')}
                disabled={busy}
                className="text-[9px] font-semibold text-navy-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                title="Найти фото на Pexels"
              >
                {imgBusy === 'stock' ? '…' : card.stockMeta ? '🔁 ещё' : '🔍 найти'}
              </button>
              {card.stockMeta && (
                <button
                  type="button"
                  onClick={() => delImage('stock')}
                  disabled={busy}
                  className="text-[9px] font-semibold text-red-600 hover:bg-red-50 border border-red-200/40 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                  title="Удалить стоковое фото"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>
      </td>

      {/* Итог (слот final): превью + действия */}
      <td className="p-2.5">
        <div className="flex flex-col items-start gap-1.5">
          {card.imageMeta ? (
            <a
              href={api.cardImageUrl(deckId, card.id, card.imageMeta.at)}
              target="_blank"
              rel="noreferrer"
              title="Открыть итоговую картинку"
            >
              <img
                src={api.cardImageUrl(deckId, card.id, card.imageMeta.at)}
                alt={card.name}
                className="w-20 h-20 object-cover rounded-lg border border-slate-200 shadow-sm"
              />
            </a>
          ) : (
            <div className="w-20 h-20 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center text-[9px] text-navy-300 text-center px-1">
              нет итога
            </div>
          )}

          {card.imageMeta && (
            <span className="text-[9px] text-navy-400 leading-tight">
              {card.imageMeta.kind === 'generate'
                ? '🎨 генерация'
                : card.imageMeta.kind === 'stylize'
                ? '🖌 стилизация'
                : '📷 сток'}
            </span>
          )}

          {card.imagePrompt && (
            <div className="flex flex-wrap items-center gap-1">
              {card.stockMeta && (
                <button
                  type="button"
                  onClick={() => makeImage('stock-as-final')}
                  disabled={busy}
                  className="text-[9px] font-semibold text-navy-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                  title="Взять стоковое фото как итог"
                >
                  {imgBusy === 'stock-as-final' ? '…' : '↙ сток'}
                </button>
              )}
              {media.stylize && card.stockMeta && (
                <button
                  type="button"
                  onClick={() => makeImage('stylize')}
                  disabled={busy}
                  className="text-[9px] font-semibold text-sea-700 bg-sea-50 hover:bg-sea-100 border border-sea-200/40 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                  title="Стилизовать сток под карту (img2img)"
                >
                  {imgBusy === 'stylize' ? '…' : '🖌 стиль'}
                </button>
              )}
              {media.generate && (
                <button
                  type="button"
                  onClick={() => makeImage('generate')}
                  disabled={busy}
                  className="text-[9px] font-semibold text-beam-700 bg-beam-50 hover:bg-beam-100 border border-beam-200/40 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                  title="Сгенерировать с нуля (FLUX)"
                >
                  {imgBusy === 'generate' ? '…' : '🎨 ген'}
                </button>
              )}
              {card.imageMeta && (
                <button
                  type="button"
                  onClick={() => delImage('final')}
                  disabled={busy}
                  className="text-[9px] font-semibold text-red-600 hover:bg-red-50 border border-red-200/40 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
                  title="Удалить итог"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          {imgErr && <span className="text-[9px] text-red-600 leading-tight max-w-[90px]">{imgErr}</span>}
        </div>
      </td>

      {/* Тип */}
      <td className="p-2.5">
        <div className="flex flex-col items-start gap-1.5">
          <TaskTypeBadge type={card.extraMaterialType} />
          <span className="text-[10px] font-semibold text-navy-400 leading-tight" title={card.patternName}>
            ⚡ {card.patternName}
          </span>
        </div>
      </td>

      {/* Вердикт + управление */}
      <td className="p-2.5">
        <div className="flex flex-col items-start gap-1.5">
          <VerdictBadge verdict={v} />
          {!editing && weak && v?.constraintIssues && v.constraintIssues.length > 0 && (
            <ul className="text-[10px] text-amber-700 leading-snug space-y-0.5 list-disc pl-3.5">
              {v.constraintIssues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          )}
          {err && <div className="text-[10px] text-red-600 leading-snug">{err}</div>}
          {editing ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Button variant="primary" className="px-2.5 py-1 text-[11px]" onClick={save} loading={saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </Button>
              <Button
                variant="ghost"
                className="px-2.5 py-1 text-[11px]"
                onClick={() => {
                  setEditing(false);
                  setErr(null);
                }}
              >
                Отмена
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] font-semibold text-navy-500 hover:text-beam-700 transition-colors mt-0.5"
            >
              ✎ Править
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

type AxisFilter = 'all' | 'Я' | 'МЫ';

const SELECT_CLS =
  'border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold bg-white outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 text-navy-700';

/** Карты колоды (Стадия 3) в табличном виде с фильтрами и инлайн-правкой. */
export function CardsView({
  cards,
  deckId,
  media,
  onUpdateCard,
  onMakeImage,
  onDropImage,
}: {
  cards: Card[];
  deckId: number;
  media: MediaStatus;
  onUpdateCard?: (
    cardId: number,
    fields: { name: string; description: string; task: string; imagePrompt: string; stockQuery: string }
  ) => Promise<void>;
  onMakeImage?: (cardId: number, action: ImageAction) => Promise<void>;
  onDropImage?: (cardId: number, slot: 'stock' | 'final') => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [axisFilter, setAxisFilter] = useState<AxisFilter>('all');
  const [category, setCategory] = useState('all');
  const [onlyPassed, setOnlyPassed] = useState(false);

  const categories = useMemo(
    () => Array.from(new Set(cards.map((c) => c.category))),
    [cards]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (axisFilter !== 'all' && c.axis !== axisFilter) return false;
      if (category !== 'all' && c.category !== category) return false;
      if (onlyPassed && !c.qualityVerdict?.passed) return false;
      if (q && !(`${c.name} ${c.description}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [cards, search, axisFilter, category, onlyPassed]);

  if (cards.length === 0) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6">
      <header className="mb-4 flex items-baseline gap-2 border-b border-slate-100 pb-3.5">
        <span className="w-1.5 h-4 rounded-full bg-beam-500 shrink-0" />
        <h3 className="font-bold text-navy-950 text-base">Готовые карты учебной колоды</h3>
        <span className="text-xs text-navy-400 font-medium">
          · {cards.length} шт. в колоде, верифицировано {cards.filter((c) => c.qualityVerdict?.passed).length}
        </span>
      </header>

      {/* Тулбар фильтров */}
      <div className="flex flex-wrap items-center gap-2.5 mb-5">
        <input
          className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-3.5 py-2 text-sm bg-slate-50/50 outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 focus:bg-white placeholder:text-navy-400"
          placeholder="🔍 Поиск по названию и описанию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={SELECT_CLS} value={axisFilter} onChange={(e) => setAxisFilter(e.target.value as AxisFilter)}>
          <option value="all">Все оси</option>
          <option value="Я">Ось Я</option>
          <option value="МЫ">Ось МЫ</option>
        </select>
        <select className={SELECT_CLS} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">Все категории</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setOnlyPassed((v) => !v)}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all border ${
            onlyPassed
              ? 'bg-navy-900 text-white border-navy-900'
              : 'bg-white text-navy-600 border-slate-200 hover:bg-navy-100/60'
          }`}
          title="Только прошедшие верификацию"
        >
          ✓ только прошедшие
        </button>
      </div>

      <div className="text-[11px] text-navy-400 font-medium mb-3">
        Показано {filtered.length} из {cards.length} карт
      </div>

      {/* Таблица карт */}
      <div className="overflow-x-auto rounded-xl border border-slate-200/60 animate-fade-in">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-navy-500">
              <th className="text-right font-bold p-2.5 w-10">№</th>
              <th className="text-left font-bold p-2.5 w-12">Ось</th>
              <th className="text-left font-bold p-2.5 w-28">Категория</th>
              <th className="text-left font-bold p-2.5 w-40">Название</th>
              <th className="text-left font-bold p-2.5 w-[22%]">Описание</th>
              <th className="text-left font-bold p-2.5">Задание</th>
              <th className="text-left font-bold p-2.5 w-44">Промпт изобр.</th>
              <th className="text-left font-bold p-2.5 w-28">Стоковое фото</th>
              <th className="text-left font-bold p-2.5 w-28">Итог</th>
              <th className="text-left font-bold p-2.5 w-24">Тип</th>
              <th className="text-left font-bold p-2.5 w-36">Вердикт</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <EditableCardRow
                key={c.id}
                card={c}
                deckId={deckId}
                media={media}
                onMakeImage={onMakeImage}
                onDropImage={onDropImage}
                onSave={(fields) =>
                  onUpdateCard
                    ? onUpdateCard(c.id, fields)
                    : Promise.reject(new Error('редактирование недоступно'))
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
