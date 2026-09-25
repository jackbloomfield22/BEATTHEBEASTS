import { useEffect, useRef, type RefObject } from 'react';
import { Input } from '@/input/InputManager';
import { Audio } from '@/audio/audio';
import { REPORT_TABS } from './GameReport';

/**
 * The box score's own keys: Q/E (LB/RB) switch tabs, ↑↓ (the D-pad, the
 * left stick) scroll the panel when it runs long. The screen's action row
 * stays on ← → and Enter (useMenuNav).
 */
export function useReportNav(o: { enabled: boolean; tab: number; setTab: (i: number) => void; scroll: RefObject<HTMLElement | null> }): void {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    return Input.onAction((id) => {
      const c = ref.current;
      if (!c.enabled) return;
      const n = REPORT_TABS.length;
      if (id === 'menu.tabPrev' || id === 'menu.tabNext') {
        Audio.uiTick();
        c.setTab((c.tab + (id === 'menu.tabNext' ? 1 : -1) + n) % n);
      } else if (id === 'menu.up' || id === 'menu.down') {
        const el = c.scroll.current;
        if (el) el.scrollBy({ top: (id === 'menu.down' ? 1 : -1) * el.clientHeight * 0.35, behavior: 'smooth' });
      }
    });
  }, []);
}
