import { useMemo, useState } from 'react';
import type { Case } from './types';

function GroupBadge({ group }: { group: 'Я' | 'МЫ' }) {
  return (
    <span
      className={`text-[10px] font-bold rounded-lg px-2 py-0.5 ring-1 ring-inset ${
        group === 'Я'
          ? 'bg-amber-50 text-amber-700 ring-amber-200/50'
          : 'bg-sea-50 text-sea-700 ring-sea-200/50'
      }`}
    >
      {group}
    </span>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const good = score >= 80;
  return (
    <span
      className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ring-1 ring-inset tabular-nums ${
        good
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60'
          : 'bg-slate-100 text-slate-500 ring-slate-200/60'
      }`}
      title={`Оценка: ${score}`}
    >
      {score}
    </span>
  );
}

function StatusCell({ status }: { status?: Case['status'] }) {
  if (status === 'duplicate')
    return (
      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
        дубликат
      </span>
    );
  if (status === 'rejected')
    return (
      <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
        отклонён
      </span>
    );
  return (
    <span className="text-[10px] font-bold text-sea-700 bg-sea-50 px-2 py-0.5 rounded">
      активный
    </span>
  );
}

type AxisFilter = 'all' | 'Я' | 'МЫ';
type StatusFilter = 'all' | 'active' | 'duplicate' | 'rejected';

const SELECT_CLS =
  'border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold bg-white outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 text-navy-700';

/** Банк собранных кейсов (Стадия 1+2) в табличном виде с фильтрами и разворотом строк. */
export function CasesView({ cases }: { cases: Case[] }) {
  const [search, setSearch] = useState('');
  const [axis, setAxis] = useState<AxisFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sortByScore, setSortByScore] = useState(false);

  const scored = cases.some((c) => c.score != null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = cases.filter((c) => {
      if (axis !== 'all' && c.group !== axis) return false;
      if (status !== 'all' && (c.status ?? 'active') !== status) return false;
      if (q && !(`${c.title} ${c.summary}`.toLowerCase().includes(q))) return false;
      return true;
    });
    if (sortByScore) {
      list = [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    }
    return list;
  }, [cases, search, axis, status, sortByScore]);

  if (cases.length === 0) return null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-5">
      {/* Тулбар */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <input
          className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-3.5 py-2 text-sm bg-slate-50/50 outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100 focus:bg-white placeholder:text-navy-400"
          placeholder="🔍 Поиск по заголовку и описанию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={SELECT_CLS} value={axis} onChange={(e) => setAxis(e.target.value as AxisFilter)}>
          <option value="all">Все оси</option>
          <option value="Я">Ось Я</option>
          <option value="МЫ">Ось МЫ</option>
        </select>
        <select
          className={SELECT_CLS}
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          <option value="all">Все статусы</option>
          <option value="active">Активные</option>
          <option value="duplicate">Дубликаты</option>
          <option value="rejected">Отклонённые</option>
        </select>
        <button
          type="button"
          onClick={() => setSortByScore((s) => !s)}
          disabled={!scored}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
            sortByScore
              ? 'bg-navy-900 text-white border-navy-900'
              : 'bg-white text-navy-600 border-slate-200 hover:bg-navy-100/60'
          }`}
          title="Сортировать по баллу"
        >
          ↓ по баллу
        </button>
      </div>

      <div className="text-[11px] text-navy-400 font-medium mb-2">
        Показано {filtered.length} из {cases.length} кейсов
      </div>

      {/* Таблица */}
      <div className="overflow-x-auto rounded-xl border border-slate-200/60">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wider text-navy-500">
              <th className="text-right font-bold p-2.5 w-10">№</th>
              <th className="text-left font-bold p-2.5 w-20">Ячейка</th>
              <th className="text-left font-bold p-2.5 w-[30%]">Кейс</th>
              <th className="text-left font-bold p-2.5">Анализ</th>
              <th className="text-left font-bold p-2.5 w-40">Источник</th>
              <th className="text-left font-bold p-2.5 w-14">Ось</th>
              <th className="text-left font-bold p-2.5 w-28">Тип</th>
              <th className="text-center font-bold p-2.5 w-14">Балл</th>
              <th className="text-left font-bold p-2.5 w-24">Статус</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, i) => {
              const dimmed = c.status === 'duplicate' || c.status === 'rejected';
              const isUrl = !!c.source && /^https?:\/\//i.test(c.source);
              return (
                <tr
                  key={c.id}
                  className={`border-t border-slate-100 align-top transition-colors hover:bg-slate-50/70 ${
                    dimmed ? 'opacity-55' : ''
                  }`}
                >
                  <td className="p-2.5 text-right text-[11px] font-mono font-bold text-navy-400 tabular-nums">
                    {i + 1}
                  </td>
                  <td className="p-2.5">
                    <span className="text-[10px] font-mono font-bold text-navy-500 bg-slate-100 rounded px-1.5 py-0.5">
                      {c.matrixCell}
                    </span>
                  </td>
                  <td className="p-2.5">
                    <div className="font-semibold text-navy-900 leading-snug">{c.title}</div>
                    {c.summary && (
                      <p className="text-[11px] text-navy-500 leading-relaxed mt-1">{c.summary}</p>
                    )}
                  </td>
                  <td className="p-2.5 text-[11px] text-navy-600 leading-relaxed">
                    {c.analytics || <span className="text-navy-300">—</span>}
                  </td>
                  <td className="p-2.5">
                    {c.source ? (
                      isUrl ? (
                        <a
                          href={c.source}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[10px] text-sea-600 hover:text-sea-700 hover:underline inline-flex items-start gap-1 break-all"
                          title={c.source}
                        >
                          <span className="shrink-0">⚓</span>
                          <span className="line-clamp-3">{c.source}</span>
                        </a>
                      ) : (
                        <span className="text-[10px] text-navy-400 italic flex items-start gap-1">
                          <span className="shrink-0">⚓</span> <span>{c.source}</span>
                        </span>
                      )
                    ) : (
                      <span className="text-navy-300">—</span>
                    )}
                  </td>
                  <td className="p-2.5">{c.group && <GroupBadge group={c.group} />}</td>
                  <td className="p-2.5 text-[11px] text-navy-500">{c.problemType}</td>
                  <td className="p-2.5 text-center">{c.score != null && <ScoreBadge score={c.score} />}</td>
                  <td className="p-2.5">
                    <StatusCell status={c.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
