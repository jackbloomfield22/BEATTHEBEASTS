import { useEffect, useRef } from 'react';
import { Input } from '@/input/InputManager';
import { Audio } from '@/audio/audio';

// Menu navigation shared by every screen: keyboard, gamepad and mouse drive
// one focus index. Mouse hover moves focus; clicks confirm. Screens stay dumb
// lists of rows; this hook turns actions into focus changes and callbacks.

export interface NavOptions {
  count: number;
  focus: number;
  setFocus: (i: number) => void;
  onConfirm?: (i: number) => void;
  onBack?: () => void;
  onLeft?: (i: number, repeat: boolean) => void;
  onRight?: (i: number, repeat: boolean) => void;
  onTabPrev?: () => void;
  onTabNext?: () => void;
  onAlt?: (i: number) => void;
  onAlt2?: (i: number) => void;
  /** Items (by index) that can't be focused. */
  isDisabled?: (i: number) => boolean;
  /** Grid columns (1 = vertical list). */
  columns?: number;
  enabled?: boolean;
  wrap?: boolean;
}

export function useMenuNav(opts: NavOptions): void {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    return Input.onAction((id, info) => {
      const o = ref.current;
      if (o.enabled === false) return;
      const cols = o.columns ?? 1;
      const move = (delta: number) => {
        if (o.count === 0) return;
        let i = o.focus;
        for (let step = 0; step < o.count; step++) {
          let next = i + delta;
          if (next < 0 || next >= o.count) {
            if (o.wrap === false || cols > 1) return;
            next = (next + o.count) % o.count;
          }
          i = next;
          if (!o.isDisabled?.(i)) break;
        }
        if (i !== o.focus) {
          o.setFocus(i);
          Audio.uiHover();
        }
      };
      switch (id) {
        case 'menu.up':
          move(-cols);
          break;
        case 'menu.down':
          move(cols);
          break;
        case 'menu.left':
          if (o.onLeft) o.onLeft(o.focus, info.repeat);
          else if (cols > 1) move(-1);
          break;
        case 'menu.right':
          if (o.onRight) o.onRight(o.focus, info.repeat);
          else if (cols > 1) move(1);
          break;
        case 'menu.confirm':
          if (!info.repeat && o.onConfirm && !o.isDisabled?.(o.focus)) o.onConfirm(o.focus);
          break;
        case 'menu.back':
          if (!info.repeat && o.onBack) {
            Audio.uiBack();
            o.onBack();
          }
          break;
        case 'menu.tabPrev':
          o.onTabPrev?.();
          break;
        case 'menu.tabNext':
          o.onTabNext?.();
          break;
        case 'menu.alt':
          if (!info.repeat) o.onAlt?.(o.focus);
          break;
        case 'menu.alt2':
          if (!info.repeat) o.onAlt2?.(o.focus);
          break;
      }
    });
  }, []);
}
