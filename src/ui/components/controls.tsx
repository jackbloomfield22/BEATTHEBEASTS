import { useEffect, useState, type ReactNode } from 'react';
import { Input, type Device } from '@/input/InputManager';
import { Audio } from '@/audio/audio';

// Custom game controls: no browser-default widgets anywhere. Every control is
// a focusable row driven by the shared nav (left/right changes values).

export function MenuItem({
  label,
  focused,
  disabled,
  tag,
  sub,
  onHover,
  onClick,
  size = 'lg',
}: {
  label: string;
  focused: boolean;
  disabled?: boolean;
  tag?: string;
  sub?: string;
  onHover: () => void;
  onClick: () => void;
  size?: 'lg' | 'md';
}) {
  return (
    <button
      className={`menu-item ${size} ${focused ? 'is-focused' : ''} ${disabled ? 'is-disabled' : ''}`}
      onMouseEnter={() => {
        if (!focused) Audio.uiHover();
        onHover();
      }}
      onClick={onClick}
      tabIndex={-1}
    >
      <span className="menu-item-bar" />
      <span className="menu-item-label">{label}</span>
      {tag ? <span className="menu-item-tag">{tag}</span> : null}
      {sub ? <span className="menu-item-sub">{sub}</span> : null}
    </button>
  );
}

export function SettingRow({
  label,
  focused,
  onHover,
  onClick,
  children,
  disabled,
}: {
  label: string;
  focused: boolean;
  onHover: () => void;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`setting-row ${focused ? 'is-focused' : ''} ${disabled ? 'is-disabled' : ''}`} onMouseEnter={onHover} onClick={onClick}>
      <span className="setting-label">{label}</span>
      <span className="setting-value">{children}</span>
    </div>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      className={`toggle ${value ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        Audio.uiTick();
        onChange(!value);
      }}
    >
      <span className="toggle-opt">Off</span>
      <span className="toggle-opt">On</span>
      <span className="toggle-thumb" />
    </span>
  );
}

export function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d: number) => {
    const next = options[(i + d + options.length) % options.length]!;
    Audio.uiTick();
    onChange(next.value);
  };
  return (
    <span className="choice">
      <span className="choice-arrow" onClick={(e) => { e.stopPropagation(); step(-1); }}>◀</span>
      <span className="choice-label">{options[i]?.label}</span>
      <span className="choice-pips">
        {options.map((o, k) => (
          <span key={String(o.value)} className={`pip ${k === i ? 'on' : ''}`} />
        ))}
      </span>
      <span className="choice-arrow" onClick={(e) => { e.stopPropagation(); step(1); }}>▶</span>
    </span>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const t = (value - min) / (max - min);
  const setFromX = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const v = Math.round((min + k * (max - min)) / step) * step;
    if (v !== value) {
      Audio.uiTick();
      onChange(Number(v.toFixed(4)));
    }
  };
  return (
    <span className="slider">
      <span
        className="slider-track"
        onMouseDown={(e) => {
          e.stopPropagation();
          const el = e.currentTarget;
          setFromX(el, e.clientX);
          const move = (ev: MouseEvent) => setFromX(el, ev.clientX);
          const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
      >
        <span className="slider-fill" style={{ width: `${t * 100}%` }} />
        <span className="slider-thumb" style={{ left: `${t * 100}%` }} />
      </span>
      <span className="slider-value">{format ? format(value) : value}</span>
    </span>
  );
}

/** Stepping helper for sliders driven by left/right. */
export const stepValue = (v: number, dir: number, min: number, max: number, step: number, repeat: boolean): number =>
  Number(Math.min(max, Math.max(min, v + dir * step * (repeat ? 2 : 1))).toFixed(4));

/** Button prompts that follow the last-used device (keyboard or gamepad). */
export function Hints({ items }: { items: { kb: string; pad: string; label: string }[] }) {
  const device = useDevice();
  return (
    <div className="hints">
      {items.map((h) => (
        <span key={h.label} className="hint">
          <kbd className={device === 'gamepad' ? `pad pad-${h.pad}` : ''}>{device === 'gamepad' ? h.pad : h.kb}</kbd>
          {h.label}
        </span>
      ))}
    </div>
  );
}

export function useDevice(): Device {
  const [d, setD] = useState<Device>(Input.lastDevice);
  useEffect(() => {
    return Input.onDevice(setD);
  }, []);
  return d;
}
