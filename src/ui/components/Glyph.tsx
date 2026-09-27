import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { useSettings } from '@/app/settings';
import { Input, type Device } from '@/input/InputManager';
import { inputLabel } from '@/input/actions';
import { padGlyph, parsePadHint, promptCode, promptDeviceOf, type PadGlyphSpec, type PromptDevice } from '@/input/prompts';

// Button glyphs, drawn in-house as inline SVG (M6.6): the pad's face
// buttons in their colours, the bumpers and triggers in their shapes, the
// sticks and the D-pad with the direction lit. Keys stay keycaps. Sized in
// em, so a glyph is as large as the prompt it sits in.

const INK = '#f4f0ff';
const BODY = '#15131f';
const LINE = 'rgba(244,240,255,.72)';

/** The device last used (keyboard, mouse or gamepad); re-renders when it changes. */
export function useDevice(): Device {
  return useSyncExternalStore(subscribeDevice, deviceNow);
}
const subscribeDevice = (cb: () => void) => Input.onDevice(cb);
const deviceNow = () => Input.lastDevice;

/** The device the prompts are drawn for now (follows the last input; `?pad` holds it on the pad). */
export function usePromptDevice(): PromptDevice {
  return promptDeviceOf(useDevice());
}

function Svg({ vb, kind, children, title }: { vb: string; kind: string; children: ReactNode; title: string }) {
  return (
    <span className={`glyph glyph-${kind}`} role="img" aria-label={title}>
      <svg viewBox={vb} aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

const ROT = { up: 0, right: 90, down: 180, left: 270 } as const;

/** One gamepad input, drawn. */
export function PadGlyph({ spec, title }: { spec: PadGlyphSpec; title: string }) {
  switch (spec.kind) {
    case 'face':
      return (
        <Svg vb="0 0 24 24" kind="face" title={title}>
          <circle cx="12" cy="12" r="10.6" fill={BODY} stroke={spec.color} strokeWidth="1.7" />
          <text x="12" y="16.3" textAnchor="middle" fontSize="12.5" fontWeight="800" fill={spec.color}>
            {spec.letter}
          </text>
        </Svg>
      );
    case 'bumper':
      return (
        <Svg vb="0 0 34 22" kind="bumper" title={title}>
          <path d="M2.5,19 V10.5 C2.5,6 6,3.5 11,3.5 H23 C28,3.5 31.5,6 31.5,10.5 V19 Z" fill={BODY} stroke={LINE} strokeWidth="1.5" strokeLinejoin="round" />
          <text x="17" y="15.6" textAnchor="middle" fontSize="9.5" fontWeight="800" fill={INK}>
            {spec.label}
          </text>
        </Svg>
      );
    case 'trigger':
      return (
        <Svg vb="0 0 24 26" kind="trigger" title={title}>
          <path d="M4.5,24 V10 C4.5,5 7.5,2 12,2 C16.5,2 19.5,5 19.5,10 V24 Z" fill={BODY} stroke={LINE} strokeWidth="1.5" strokeLinejoin="round" />
          <text x="12" y="19" textAnchor="middle" fontSize="8.6" fontWeight="800" fill={INK}>
            {spec.label}
          </text>
        </Svg>
      );
    case 'stick':
      return (
        <Svg vb="0 0 26 26" kind="stick" title={title}>
          <circle cx="13" cy="13" r="11.4" fill={BODY} stroke={LINE} strokeWidth="1.4" />
          <circle cx="13" cy="13" r="6.6" fill="#2a2738" stroke={spec.click ? INK : LINE} strokeWidth={spec.click ? 1.8 : 1.1} />
          {spec.click ? <circle cx="13" cy="13" r="3.9" fill="none" stroke={INK} strokeWidth="1" /> : null}
          <text x="13" y="15.9" textAnchor="middle" fontSize="7.6" fontWeight="800" fill={INK}>
            {spec.side}
          </text>
          {spec.dir ? <polygon points="13,1.9 10,5.6 16,5.6" fill={INK} transform={`rotate(${ROT[spec.dir]} 13 13)`} /> : null}
        </Svg>
      );
    case 'dpad': {
      const lit = (d: 'up' | 'down' | 'left' | 'right') => spec.dir === d || (spec.dir === 'vertical' && (d === 'up' || d === 'down')) || (spec.dir === 'horizontal' && (d === 'left' || d === 'right'));
      return (
        <Svg vb="0 0 24 24" kind="dpad" title={title}>
          <path d="M8.6,1.8 H15.4 V8.6 H22.2 V15.4 H15.4 V22.2 H8.6 V15.4 H1.8 V8.6 H8.6 Z" fill={BODY} stroke={LINE} strokeWidth="1.4" strokeLinejoin="round" />
          {lit('up') ? <polygon points="12,3.6 9.4,7.4 14.6,7.4" fill={INK} /> : null}
          {lit('down') ? <polygon points="12,20.4 9.4,16.6 14.6,16.6" fill={INK} /> : null}
          {lit('left') ? <polygon points="3.6,12 7.4,9.4 7.4,14.6" fill={INK} /> : null}
          {lit('right') ? <polygon points="20.4,12 16.6,9.4 16.6,14.6" fill={INK} /> : null}
        </Svg>
      );
    }
    case 'view':
      return (
        <Svg vb="0 0 24 24" kind="view" title={title}>
          <circle cx="12" cy="12" r="10.6" fill={BODY} stroke={LINE} strokeWidth="1.4" />
          <rect x="6.4" y="7.2" width="7.4" height="5.6" rx="1" fill="none" stroke={INK} strokeWidth="1.3" />
          <rect x="10.2" y="11.2" width="7.4" height="5.6" rx="1" fill={BODY} stroke={INK} strokeWidth="1.3" />
        </Svg>
      );
    case 'menu':
      return (
        <Svg vb="0 0 24 24" kind="menu" title={title}>
          <circle cx="12" cy="12" r="10.6" fill={BODY} stroke={LINE} strokeWidth="1.4" />
          <path d="M7,8.2 H17 M7,12 H17 M7,15.8 H17" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
        </Svg>
      );
  }
}

/** One input, as it's drawn: a pad glyph for a `Pad:` code, else a keycap. */
export function InputGlyph({ code, className }: { code: string; className?: string }) {
  const spec = padGlyph(code);
  if (spec) return <PadGlyph spec={spec} title={inputLabel(code)} />;
  return <kbd className={className}>{inputLabel(code)}</kbd>;
}

/** The bindings as they are now. */
export function useBindings() {
  const kb = useSettings((s) => s.settings.controls.keyboard);
  const pad = useSettings((s) => s.settings.controls.gamepad);
  return { kb, pad };
}

/**
 * The input bound to an action, on the device in use, drawn. `fallback` is
 * shown when the action has nothing bound on that device.
 */
export function ActionGlyph({ action, fallback = '—' }: { action: string; fallback?: string }) {
  const device = usePromptDevice();
  const { kb, pad } = useBindings();
  const code = promptCode(action, device, kb, pad);
  return code ? <InputGlyph code={code} /> : <kbd>{fallback}</kbd>;
}

/** A function that draws an action's input (for lists of prompts). */
export function useActionGlyph(): (action: string) => ReactNode {
  const device = usePromptDevice();
  const { kb, pad } = useBindings();
  return (action: string) => {
    const code = promptCode(action, device, kb, pad);
    return code ? <InputGlyph code={code} /> : <kbd>—</kbd>;
  };
}

/** A written hint's pad side ("LB / RB", "Hold A", "D-Pad") drawn as glyphs; null if it has no pad input. */
export function PadHint({ pad, kb }: { pad: string; kb?: string }) {
  const parts = parsePadHint(pad, kb);
  if (!parts) return null;
  return (
    <span className="glyph-row">
      {parts.map((p, i) => (
        <Fragment key={i}>{typeof p === 'string' ? <span className="glyph-word">{p}</span> : <InputGlyph code={p.code} />}</Fragment>
      ))}
    </span>
  );
}

/** The key or button that switches tabs, beside a row of tabs (Q/E or LB/RB). */
export function TabKey({ dir }: { dir: 'prev' | 'next' }) {
  const device = usePromptDevice();
  const { kb, pad } = useBindings();
  const code = promptCode(dir === 'prev' ? 'menu.tabPrev' : 'menu.tabNext', device, kb, pad);
  if (code && device === 'pad') return <span className="tab-key is-pad">{<InputGlyph code={code} />}</span>;
  return <span className="tab-key">{code ? inputLabel(code) : dir === 'prev' ? 'Q' : 'E'}</span>;
}
