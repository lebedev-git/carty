import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Изящный современный логотип-маяк */
export function Lighthouse({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      {/* Мягкие объемные лучи света */}
      <path d="M22 14 L2 6v6l20 6z" className="fill-beam-400/30 animate-beam-pulse" />
      <path d="M26 14 L46 6v6l-20 8z" className="fill-beam-400/30 animate-beam-pulse" />
      
      {/* Элегантное сияние вокруг фонаря */}
      <circle cx="24" cy="14" r="7" className="fill-beam-300/20" />
      <circle cx="24" cy="14" r="4.5" className="fill-beam-400" />
      <circle cx="24" cy="14" r="2" className="fill-white" />
      
      {/* Крыша и верхняя площадка */}
      <path d="M19 10h10l-1.5-2.5h-7z" className="fill-navy-700" />
      <rect x="18" y="11.5" width="12" height="1.5" rx="0.5" className="fill-navy-600" />
      
      {/* Фонарная кабина */}
      <rect x="20.5" y="13" width="7" height="4.5" rx="0.5" className="fill-navy-900/10 stroke-navy-700" strokeWidth="1" />
      <line x1="24" y1="13" x2="24" y2="17.5" className="stroke-navy-700" strokeWidth="1" />
      
      {/* Тело маяка с аккуратными полосами */}
      <path d="M19.5 17.5 h9 L31.5 40 H16.5 z" className="fill-white stroke-navy-200" strokeWidth="0.5" />
      
      {/* Фирменные золотые полосы с закруглением */}
      <path d="M18.8 23.5 h10.4 L29.6 28 H18.4 z" className="fill-gradient-to-b fill-beam-500" />
      <path d="M17.4 31 h13.2 L31 35.5 H17 z" className="fill-gradient-to-b fill-beam-500" />
      
      {/* Основание маяка */}
      <rect x="14" y="39.5" width="20" height="3" rx="1" className="fill-navy-800" />
    </svg>
  );
}

/** Иконка Замка */
export function LockIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

/** Иконка Галочки */
export function CheckIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/** Иконка Предупреждения/Ошибки */
export function AlertIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

/** Иконка-шеврон (раскрытие блоков). */
export function ChevronIcon({ className = 'w-4 h-4', open = false }: { className?: string; open?: boolean }) {
  return (
    <svg
      className={`${className} transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Иконка «код/промпт». */
export function CodeIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}

/** Кольцевой спиннер. */
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

type Variant = 'primary' | 'navy' | 'success' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-beam-500 to-beam-600 text-navy-950 font-semibold hover:from-beam-400 hover:to-beam-500 active:scale-[0.98] shadow-sm shadow-beam-500/25 focus-visible:ring-beam-400 border border-beam-600/10',
  navy: 'bg-navy-900 text-white hover:bg-navy-800 active:scale-[0.98] shadow-sm focus-visible:ring-navy-500',
  success: 'bg-gradient-to-r from-sea-600 to-sea-700 text-white font-medium hover:from-sea-500 hover:to-sea-600 active:scale-[0.98] shadow-sm focus-visible:ring-sea-500',
  ghost: 'text-navy-600 hover:text-navy-950 hover:bg-navy-100/70 focus-visible:ring-navy-300',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({
  variant = 'navy',
  loading = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:scale-100 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Spinner className="w-4 h-4" /> : null}
      {children}
    </button>
  );
}

/** Цветовые схемы статусов колоды. */
const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200/70',
  profiled: 'bg-amber-50 text-amber-700 ring-amber-200/50',
  profile_frozen: 'bg-teal-50 text-teal-700 ring-teal-200/50',
  sourced: 'bg-indigo-50 text-indigo-700 ring-indigo-200/50',
  validated: 'bg-blue-50 text-blue-700 ring-blue-200/50',
  cards: 'bg-emerald-50 text-emerald-700 ring-emerald-200/50',
  error: 'bg-red-50 text-red-700 ring-red-200/50',
};

export function StatusBadge({
  status,
  label,
  frozen,
}: {
  status: string;
  label: ReactNode;
  frozen?: boolean;
}) {
  const style = STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200/70';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition-all duration-200 ${style}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
      <span>{label}</span>
      {frozen && <LockIcon className="w-3 h-3 text-teal-600/90 ml-0.5 shrink-0" />}
    </span>
  );
}

/** Один таб: ключ, подпись, опциональный счётчик и блокировка. */
export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  disabled?: boolean;
}

/**
 * Переключатель вкладок (пилюли). Заблокированные табы кликнуть нельзя —
 * ведём пользователя по пайплайну (кейсы недоступны без профиля и т.п.).
 */
export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1 p-1 rounded-2xl bg-white/70 backdrop-blur border border-slate-200/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] ${className}`}
      role="tablist"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-beam-300 disabled:opacity-40 disabled:cursor-not-allowed ${
              isActive
                ? 'bg-navy-900 text-white shadow-sm'
                : 'text-navy-600 hover:text-navy-950 hover:bg-navy-100/60'
            }`}
          >
            <span>{t.label}</span>
            {t.count != null && (
              <span
                className={`text-[10px] font-bold tabular-nums rounded-full px-1.5 py-0.5 min-w-[20px] text-center ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-navy-500'
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

