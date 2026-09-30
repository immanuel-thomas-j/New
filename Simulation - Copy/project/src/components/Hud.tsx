import { Activity, Anchor, Radio, ShieldAlert, Waves } from 'lucide-react';
import { Radar } from './Radar';

export interface LogEntry { id: number; msg: string; type: 'new' | 'warn'; }

interface HudProps {
  state: 'IDLE' | 'RESCUE' | 'RETURN';
  speed: number;
  logs: LogEntry[];
  victim: { x: number; z: number } | null;
  onLaunch: () => void;
}

const STATE_LABEL: Record<HudProps['state'], string> = {
  IDLE: 'STANDBY',
  RESCUE: 'RESCUE EN ROUTE',
  RETURN: 'RETURNING',
};

const STATE_COLOR: Record<HudProps['state'], string> = {
  IDLE: 'text-cyan-300',
  RESCUE: 'text-rose-300',
  RETURN: 'text-amber-300',
};

const STATE_DOT: Record<HudProps['state'], string> = {
  IDLE: 'bg-cyan-400',
  RESCUE: 'bg-rose-400 animate-pulse',
  RETURN: 'bg-amber-400 animate-pulse',
};

export function Hud({ state, speed, logs, victim, onLaunch }: HudProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      {/* Top bar */}
      <header className="absolute top-0 inset-x-0 px-4 sm:px-6 py-3 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-lg bg-cyan-500/20 ring-1 ring-cyan-400/40">
            <Anchor className="w-5 h-5 text-cyan-300" strokeWidth={2.2} />
          </div>
          <div className="leading-tight">
            <h1 className="text-white font-semibold tracking-wide text-sm sm:text-base">
              SHORELINE GUARDIAN
            </h1>
            <p className="text-cyan-200/70 text-[10px] sm:text-xs tracking-[0.2em] uppercase">
              Coastal Rescue Command
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 ring-1 ring-white/10">
          <span className={`w-2 h-2 rounded-full ${STATE_DOT[state]}`} />
          <span className={`text-xs font-semibold tracking-wider ${STATE_COLOR[state]}`}>
            {STATE_LABEL[state]}
          </span>
        </div>
      </header>

      {/* Left telemetry */}
      <aside className="absolute left-4 sm:left-6 top-20 sm:top-24 w-44 sm:w-52 pointer-events-auto">
        <div className="rounded-2xl bg-slate-900/55 backdrop-blur-md ring-1 ring-white/10 p-3.5 shadow-2xl">
          <div className="flex items-center gap-2 text-cyan-300 mb-3">
            <Activity className="w-4 h-4" />
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">Telemetry</span>
          </div>
          <Stat label="Boat Speed" value={`${speed.toFixed(1)} kn`} />
          <Stat label="Sea State" value="2 · Calm" />
          <Stat label="Wind" value="12 kn NW" />
          <Stat label="Visibility" value="Good" />
          <div className="mt-3 pt-3 border-t border-white/10">
            <div className="flex items-center gap-2 text-emerald-300">
              <Radio className="w-3.5 h-3.5" />
              <span className="text-[10px] tracking-[0.18em] uppercase">Channel 16 Open</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Right radar + log */}
      <aside className="absolute right-4 sm:right-6 top-20 sm:top-24 w-44 sm:w-52 pointer-events-auto">
        <div className="rounded-2xl bg-slate-900/55 backdrop-blur-md ring-1 ring-white/10 p-3.5 shadow-2xl">
          <div className="flex items-center gap-2 text-cyan-300 mb-2">
            <Waves className="w-4 h-4" />
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">Sector Radar</span>
          </div>
          <div className="grid place-items-center">
            {/* Radar canvas injected by parent via children-free prop pattern */}
            <RadarSlot victim={victim} />
          </div>
          <p className="mt-2 text-center text-[10px] text-cyan-200/60 tracking-wider">
            {victim ? 'SIGNAL ACQUIRED' : 'SCANNING…'}
          </p>
        </div>
        <div className="mt-3 rounded-2xl bg-slate-900/55 backdrop-blur-md ring-1 ring-white/10 p-3.5 shadow-2xl">
          <div className="flex items-center gap-2 text-amber-300 mb-2">
            <ShieldAlert className="w-4 h-4" />
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">Dispatch Log</span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-hidden">
            {logs.slice(-5).map((l) => (
              <div key={l.id} className="flex gap-2 text-[11px] leading-snug">
                <span className={l.type === 'warn' ? 'text-rose-300' : 'text-cyan-300'}>
                  {l.type === 'warn' ? '!' : '›'}
                </span>
                <span className="text-slate-200/90">{l.msg}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-[11px] text-slate-400/70">No active dispatches.</p>
            )}
          </div>
        </div>
      </aside>

      {/* Bottom action */}
      <footer className="absolute bottom-0 inset-x-0 px-4 sm:px-6 py-5 flex flex-col items-center gap-2 bg-gradient-to-t from-black/55 to-transparent">
        <button
          onClick={onLaunch}
          disabled={state !== 'IDLE'}
          className={`pointer-events-auto group relative px-7 sm:px-9 py-3 rounded-full font-semibold tracking-wide text-sm transition-all duration-300 ${
            state === 'IDLE'
              ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-[0_0_30px_rgba(244,63,94,.5)] hover:shadow-[0_0_45px_rgba(244,63,94,.7)] hover:scale-105'
              : 'bg-slate-700/60 text-slate-400 cursor-not-allowed'
          }`}
        >
          <span className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            {state === 'IDLE' ? 'LAUNCH RESCUE' : 'MISSION IN PROGRESS'}
          </span>
        </button>
        <p className="text-[10px] text-white/45 tracking-wider hidden sm:block">
          Left-drag: orbit · Right-drag: pan · Scroll: zoom · Shift+scroll: height
        </p>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-[12px] text-white font-medium tabular-nums">{value}</span>
    </div>
  );
}

function RadarSlot({ victim }: { victim: { x: number; z: number } | null }) {
  return <Radar victim={victim} />;
}
