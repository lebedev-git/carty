import { useEffect, useState } from 'react';
import type { StagePrompt } from './types';
import { Button, ChevronIcon, CodeIcon } from './ui';

interface Props {
  prompt: StagePrompt | undefined;
  busy: boolean;
  /** system === '' означает сброс к стандартному (удаление оверрайда). */
  onSave: (system: string) => void;
}

/**
 * Сворачиваемая панель промпта стадии.
 * - system-промпт редактируемый (его реально использует бэкенд при запуске);
 * - user-промпт показывается только для чтения как реальный пример (строится из данных).
 */
export function PromptPanel({ prompt, busy, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(prompt?.system ?? '');

  useEffect(() => {
    setDraft(prompt?.system ?? '');
  }, [prompt?.system]);

  if (!prompt) return null;

  const overridden = prompt.system !== prompt.defaultSystem;
  const dirty = draft !== prompt.system;

  return (
    <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-slate-100/60 transition-colors"
      >
        <ChevronIcon className="w-4 h-4 text-navy-400 shrink-0" open={open} />
        <CodeIcon className="w-4 h-4 text-navy-400 shrink-0" />
        <span className="text-sm font-semibold text-navy-700">Промпт стадии</span>
        {overridden && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-beam-700 bg-beam-50 border border-beam-200/50 px-2 py-0.5 rounded-full">
            изменён
          </span>
        )}
        <span className="ml-auto text-[11px] text-navy-400 font-medium">
          {open ? 'свернуть' : 'показать и отредактировать'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-200/60 pt-4">
          {/* Редактируемый system */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-navy-500">
                Системный промпт <span className="font-normal text-navy-400">(редактируется — его получит модель)</span>
              </span>
              <div className="flex items-center gap-2">
                {overridden && (
                  <button
                    type="button"
                    className="text-[11px] font-semibold text-navy-500 hover:text-navy-800 underline decoration-dotted"
                    onClick={() => onSave('')}
                    disabled={busy}
                    title="Вернуть стандартный промпт"
                  >
                    Сбросить к стандартному
                  </button>
                )}
                <Button
                  variant="navy"
                  className="px-4 py-1.5 text-xs"
                  onClick={() => onSave(draft)}
                  loading={busy}
                  disabled={!dirty || busy}
                >
                  Сохранить
                </Button>
              </div>
            </div>
            <textarea
              className="w-full font-mono text-xs leading-relaxed border border-slate-200 rounded-lg px-3 py-2.5 bg-white min-h-[160px] resize-y outline-none transition-all focus:border-beam-500 focus:ring-2 focus:ring-beam-100"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Read-only пример user-промпта */}
          <div>
            <span className="text-xs font-bold text-navy-500">
              Промпт-задание <span className="font-normal text-navy-400">(пример; строится автоматически из данных колоды)</span>
            </span>
            <pre className="mt-1.5 w-full font-mono text-[11px] leading-relaxed text-navy-700 border border-slate-200 rounded-lg px-3 py-2.5 bg-white max-h-[300px] overflow-auto whitespace-pre-wrap">
              {prompt.userExample}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
