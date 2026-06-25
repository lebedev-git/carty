import { useEffect, useState } from 'react';
import type { DeckProfile, MatrixCell } from './types';
import { Button } from './ui';

interface Props {
  profile: DeckProfile;
  busy: string | null;
  onSave: (p: DeckProfile) => void;
  onRegenerate: () => void;
}

export function ProfileEditor({ profile, busy, onSave, onRegenerate }: Props) {
  const [draft, setDraft] = useState<DeckProfile>(profile);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(profile);
    setDirty(false);
  }, [profile]);

  function patch(p: Partial<DeckProfile>) {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  }

  function cell(m: string, c: string): MatrixCell | undefined {
    return draft.matrix.find((x) => x.m === m && x.c === c);
  }
  function setCell(m: string, c: string, themes: string[]) {
    const exists = draft.matrix.some((x) => x.m === m && x.c === c);
    const matrix = exists
      ? draft.matrix.map((x) => (x.m === m && x.c === c ? { ...x, seedThemes: themes } : x))
      : [...draft.matrix, { m, c, seedThemes: themes }];
    patch({ matrix });
  }

  const readOnly = false;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Панель действий */}
      <div className="glass-panel rounded-2xl p-4 flex flex-wrap items-center gap-3 sticky top-[72px] z-20 shadow-sm border border-slate-200/80">
        <Button
          variant="navy"
          onClick={() => onSave(draft)}
          loading={busy === 'save'}
          disabled={!dirty}
          className="px-5"
        >
          {busy === 'save' ? 'Сохранение…' : 'Сохранить правки'}
        </Button>
        {dirty && (
          <span className="text-xs text-beam-700 bg-beam-50 border border-beam-200/40 px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-beam-500 animate-pulse" />
            Есть несохранённые правки
          </span>
        )}
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={onRegenerate}
          loading={busy === 'profiler'}
        >
          {busy === 'profiler' ? 'Перегенерация…' : '↻ Перегенерировать'}
        </Button>
      </div>

      {/* Аудитория */}
      <Section title="Аудитория" hint="Кому адресована колода">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Название" value={draft.audience.name} readOnly={readOnly}
              onChange={(v) => patch({ audience: { ...draft.audience, name: v } })} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Описание" textarea value={draft.audience.description} readOnly={readOnly}
              onChange={(v) => patch({ audience: { ...draft.audience, description: v } })} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Сегменты (через запятую)" value={draft.audience.segments.join(', ')} readOnly={readOnly}
              onChange={(v) => patch({ audience: { ...draft.audience, segments: v.split(',').map((s) => s.trim()).filter(Boolean) } })} />
          </div>
        </div>
      </Section>

      {/* Профиль боли / тон */}
      <Section title="Смысловое ядро" hint="Тон, боль и язык аудитории">
        <div className="grid gap-4">
          <Field label="Профиль боли («это про нас!»)" textarea value={draft.painProfile} readOnly={readOnly}
            onChange={(v) => patch({ painProfile: v })} />
          <Field label="Тональность" textarea value={draft.toneRules} readOnly={readOnly}
            onChange={(v) => patch({ toneRules: v })} />
          <Field label="Терминология / жаргон" textarea value={draft.terminologyNotes} readOnly={readOnly}
            onChange={(v) => patch({ terminologyNotes: v })} />
        </div>
      </Section>

      {/* Матрица M×C */}
      <Section
        title="Матрица поиска кейсов"
        hint="Функциональные блоки × кластеры стейкхолдеров"
      >
        <div className="rounded-2xl border border-slate-200/60 shadow-[0_4px_20px_rgb(0,0,0,0.01)] overflow-hidden">
          <table className="border-collapse text-xs w-full table-fixed">
            <thead>
              <tr>
                <th className="border-b border-r border-slate-200 bg-slate-100 text-navy-950 p-2.5 text-left w-32 font-bold uppercase tracking-wider text-[10px]">
                  Блок ↓ / Кластер →
                </th>
                {draft.stakeholderClusters.map((c) => (
                  <th
                    key={c.id}
                    className="border-b border-slate-200 bg-slate-50 text-navy-900 p-2.5 text-left align-top"
                  >
                    <div className="font-bold text-navy-950 uppercase tracking-wider text-[10px]">
                      {c.id}. {c.name}
                    </div>
                    <div className="text-navy-500 font-normal mt-1 leading-relaxed text-[10px]">{c.question}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.functionalBlocks.map((m, i) => (
                <tr key={m.id} className="group/row">
                  <td
                    className={`border-b border-r border-slate-200 p-2.5 align-top ${
                      i % 2 ? 'bg-slate-50/70' : 'bg-white'
                    } group-hover/row:bg-beam-50/50 transition-colors`}
                  >
                    <div className="font-bold text-navy-950 text-xs">
                      {m.id}. {m.name}
                    </div>
                    <div className="text-navy-400 mt-1 leading-relaxed text-[10px] font-normal">{m.focus}</div>
                  </td>
                  {draft.stakeholderClusters.map((c) => {
                    const themes = cell(m.id, c.id)?.seedThemes ?? [];
                    return (
                      <td
                        key={c.id}
                        className={`border-b border-slate-100 p-1.5 align-top ${
                          i % 2 ? 'bg-slate-50/30' : 'bg-white'
                        } group-hover/row:bg-beam-50/20 transition-colors`}
                      >
                        <textarea
                          className="w-full text-xs border border-transparent resize-y min-h-[70px] rounded-lg p-2 bg-transparent transition-all duration-200 focus:outline-none focus:bg-white focus:border-beam-400 focus:ring-4 focus:ring-beam-100 shadow-none focus:shadow-sm"
                          readOnly={readOnly}
                          placeholder="Задайте темы поиска…"
                          value={themes.join('\n')}
                          onChange={(e) =>
                            setCell(
                              m.id,
                              c.id,
                              e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
                            )
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-navy-400 mt-3 font-medium">
          💡 Каждая ячейка содержит затравочные темы для поиска кейсов (по одной теме на строку).
        </p>
      </Section>

      {/* Стоп-лист */}
      <Section title="Этический стоп-лист" hint="Темы, которых колода избегает">
        <Field label="Запретные темы (по одной теме в строке)" textarea value={draft.tabooList.join('\n')} readOnly={readOnly}
          onChange={(v) => patch({ tabooList: v.split('\n').map((s) => s.trim()).filter(Boolean) })} />
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6">
      <header className="mb-5 flex items-baseline gap-2 border-b border-slate-100 pb-3.5">
        <span className="w-1.5 h-4 rounded-full bg-beam-500 shrink-0" />
        <h3 className="font-bold text-navy-950 text-base">{title}</h3>
        {hint && <span className="text-xs text-navy-400 font-medium">· {hint}</span>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
  readOnly?: boolean;
}) {
  const base =
    'mt-1.5 w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50/50 outline-none transition-all duration-200 placeholder:text-navy-400 focus:border-beam-500 focus:ring-2 focus:ring-beam-100 focus:bg-white disabled:bg-slate-100/50 disabled:text-slate-400 disabled:cursor-not-allowed';
  return (
    <label className="block">
      <span className="text-xs font-bold text-navy-500">{label}</span>
      {textarea ? (
        <textarea
          className={`${base} min-h-[90px] resize-y`}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={base}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
