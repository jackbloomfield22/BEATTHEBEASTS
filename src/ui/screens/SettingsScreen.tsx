import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/app/appStore';
import { useSettings, type Settings, type QualityPreset } from '@/app/settings';
import { enterFullscreen, exitFullscreen } from '@/app/platform';
import { ACTIONS, ACTIONS_BY_ID, CONTEXT_LABELS, defaultBindings, findConflicts, inputLabel, type InputContext } from '@/input/actions';
import { Input } from '@/input/InputManager';
import { Audio } from '@/audio/audio';
import { useMenuNav } from '../nav';
import { Choice, Hints, SettingRow, Slider, Toggle, stepValue } from '../components/controls';

type Opt<T> = { value: T; label: string };
type Row =
  | { kind: 'toggle'; label: string; desc: string; get: (s: Settings) => boolean; set: (d: Settings, v: boolean) => void }
  | { kind: 'choice'; label: string; desc: string; options: Opt<string | number>[]; get: (s: Settings) => string | number; set: (d: Settings, v: string | number) => void; after?: (v: string | number) => void }
  | { kind: 'slider'; label: string; desc: string; min: number; max: number; step: number; fmt: (v: number) => string; get: (s: Settings) => number; set: (d: Settings, v: number) => void }
  | { kind: 'action'; label: string; desc: string; run: () => void; value?: string }
  | { kind: 'header'; label: string }
  | { kind: 'bind'; actionId: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;

function markCustom(d: Settings) {
  d.graphics.preset = 'custom';
}

function buildTabs(nav: { openEditor: () => void; applyPreset: (p: QualityPreset) => void; reset: (k: keyof Omit<Settings, 'version' | 'detectedPreset'>) => void; resetBinds: () => void }): { id: string; label: string; rows: Row[] }[] {
  return [
    {
      id: 'display',
      label: 'Display',
      rows: [
        { kind: 'toggle', label: 'Fullscreen', desc: 'Play in fullscreen (toggle any time with F11 or Alt+Enter). Off by default. Leaving fullscreen during a game pauses it.', get: (s) => s.display.fullscreen, set: (d, v) => { d.display.fullscreen = v; void (v ? enterFullscreen() : exitFullscreen()); } },
        { kind: 'slider', label: 'Resolution scale', desc: 'Internal render resolution. Lower is faster; dynamic resolution adjusts below this to hold the frame rate.', min: 0.5, max: 1, step: 0.05, fmt: pct, get: (s) => s.display.resolutionScale, set: (d, v) => { d.display.resolutionScale = v; } },
        { kind: 'toggle', label: 'Dynamic resolution', desc: 'Lowers resolution during heavy moments to hold the frame rate.', get: (s) => s.display.dynamicResolution, set: (d, v) => { d.display.dynamicResolution = v; } },
        { kind: 'choice', label: 'Frame cap', desc: 'Limit the frame rate. Unlimited follows your display refresh rate (browsers always sync to the display, so there is no separate VSync switch).', options: [{ value: 0, label: 'Unlimited' }, { value: 30, label: '30' }, { value: 60, label: '60' }, { value: 120, label: '120' }, { value: 144, label: '144' }], get: (s) => s.display.frameCap, set: (d, v) => { d.display.frameCap = v as Settings['display']['frameCap']; } },
        { kind: 'slider', label: 'Field of view', desc: 'Adjusts the broadcast camera field of view.', min: -10, max: 10, step: 1, fmt: (v) => (v > 0 ? `+${v}°` : `${v}°`), get: (s) => s.display.fov, set: (d, v) => { d.display.fov = v; } },
        { kind: 'slider', label: 'HUD scale', desc: 'Size of the in-game broadcast overlay.', min: 0.8, max: 1.25, step: 0.05, fmt: pct, get: (s) => s.display.hudScale, set: (d, v) => { d.display.hudScale = v; } },
        { kind: 'toggle', label: 'Ultrawide safe area', desc: 'Keeps the HUD inside a 16:9 area on ultrawide monitors.', get: (s) => s.display.ultrawideSafeArea, set: (d, v) => { d.display.ultrawideSafeArea = v; } },
        { kind: 'toggle', label: 'FPS counter', desc: 'Shows frames per second in the corner. Press ` (backquote) for the full performance screen.', get: (s) => s.display.showFps, set: (d, v) => { d.display.showFps = v; } },
        { kind: 'action', label: 'Reset display settings', desc: 'Restore the defaults on this tab.', run: () => nav.reset('display') },
      ],
    },
    {
      id: 'graphics',
      label: 'Graphics',
      rows: [
        { kind: 'choice', label: 'Quality preset', desc: 'Sets every option below. Auto-detected on first launch.', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }, { value: 'custom', label: 'Custom' }], get: (s) => s.graphics.preset, set: () => undefined, after: (v) => v !== 'custom' && nav.applyPreset(v as QualityPreset) },
        { kind: 'choice', label: 'Shadows', desc: 'Sun shadow resolution.', options: [{ value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }], get: (s) => s.graphics.shadows, set: (d, v) => { d.graphics.shadows = v as Settings['graphics']['shadows']; markCustom(d); } },
        { kind: 'choice', label: 'Ambient occlusion', desc: 'Contact shadows in corners and under players.', options: [{ value: 'off', label: 'Off' }, { value: 'half', label: 'Half resolution' }, { value: 'full', label: 'Full resolution' }], get: (s) => s.graphics.ao, set: (d, v) => { d.graphics.ao = v as Settings['graphics']['ao']; markCustom(d); } },
        { kind: 'choice', label: 'Crowd density', desc: 'How many fully animated fans fill the bowl.', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }], get: (s) => s.graphics.crowdDensity, set: (d, v) => { d.graphics.crowdDensity = v as Settings['graphics']['crowdDensity']; markCustom(d); } },
        { kind: 'choice', label: 'Grass detail', desc: 'Real grass blades near the camera.', options: [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }], get: (s) => s.graphics.grassDetail, set: (d, v) => { d.graphics.grassDetail = v as Settings['graphics']['grassDetail']; markCustom(d); } },
        { kind: 'choice', label: 'Anti-aliasing', desc: 'SMAA smooths edges; adding MSAA costs more but is sharper on thin lines.', options: [{ value: 'smaa', label: 'SMAA' }, { value: 'smaa+msaa', label: 'SMAA + MSAA 4×' }], get: (s) => s.graphics.antialias, set: (d, v) => { d.graphics.antialias = v as Settings['graphics']['antialias']; markCustom(d); } },
        { kind: 'toggle', label: 'Bloom', desc: 'Glow around the sun, stadium lights and bright highlights.', get: (s) => s.graphics.bloom, set: (d, v) => { d.graphics.bloom = v; markCustom(d); } },
        { kind: 'toggle', label: 'Vignette', desc: 'Subtle darkening at the edges of the frame.', get: (s) => s.graphics.vignette, set: (d, v) => { d.graphics.vignette = v; markCustom(d); } },
        { kind: 'toggle', label: 'Replay depth of field', desc: 'Cinematic focus blur in replays and cutscenes.', get: (s) => s.graphics.replayDof, set: (d, v) => { d.graphics.replayDof = v; markCustom(d); } },
        { kind: 'toggle', label: 'Replay motion blur', desc: 'Camera motion blur in replays and cutscenes.', get: (s) => s.graphics.replayMotionBlur, set: (d, v) => { d.graphics.replayMotionBlur = v; markCustom(d); } },
        { kind: 'toggle', label: 'Weather particles', desc: 'Rain, snow and breath vapor.', get: (s) => s.graphics.weatherParticles, set: (d, v) => { d.graphics.weatherParticles = v; markCustom(d); } },
        { kind: 'action', label: 'Reset graphics settings', desc: 'Restore the defaults on this tab.', run: () => nav.reset('graphics') },
      ],
    },
    {
      id: 'controls',
      label: 'Controls',
      rows: [
        { kind: 'slider', label: 'Mouse sensitivity', desc: 'Replay camera and aiming sensitivity.', min: 0.25, max: 2, step: 0.05, fmt: (v) => v.toFixed(2), get: (s) => s.controls.mouseSensitivity, set: (d, v) => { d.controls.mouseSensitivity = v; } },
        { kind: 'toggle', label: 'Invert Y', desc: 'Invert vertical camera movement in replays.', get: (s) => s.controls.invertY, set: (d, v) => { d.controls.invertY = v; } },
        { kind: 'slider', label: 'Placement reticle', desc: 'How far the ball-placement reticle moves per mouse movement.', min: 0.25, max: 2, step: 0.05, fmt: (v) => v.toFixed(2), get: (s) => s.controls.reticleSensitivity, set: (d, v) => { d.controls.reticleSensitivity = v; } },
        { kind: 'slider', label: 'Touch pass hold', desc: 'How long to hold a receiver key before a driven ball becomes a touch pass.', min: 120, max: 400, step: 10, fmt: (v) => `${v} ms`, get: (s) => s.controls.bulletHoldMs, set: (d, v) => { d.controls.bulletHoldMs = v; } },
        { kind: 'choice', label: 'Ball-in-air control', desc: 'Off: catches are automatic. Assist: switch to the target with Tab. Full: you always take over the target.', options: [{ value: 'off', label: 'Off' }, { value: 'assist', label: 'Assist' }, { value: 'full', label: 'Full' }], get: (s) => s.controls.ballInAir, set: (d, v) => { d.controls.ballInAir = v as Settings['controls']['ballInAir']; } },
        { kind: 'action', label: 'Reset all bindings', desc: 'Restore every keyboard and gamepad binding.', run: nav.resetBinds },
        ...(['preSnap', 'pocket', 'ballInAir', 'carrier', 'kick', 'replay', 'global', 'playCall', 'menu'] as InputContext[]).flatMap((ctx): Row[] => [
          { kind: 'header', label: CONTEXT_LABELS[ctx] },
          ...ACTIONS.filter((a) => a.context === ctx).map((a): Row => ({ kind: 'bind', actionId: a.id })),
        ]),
      ],
    },
    {
      id: 'audio',
      label: 'Audio',
      rows: [
        { kind: 'slider', label: 'Master', desc: 'Overall volume.', min: 0, max: 1, step: 0.05, fmt: pct, get: (s) => s.audio.master, set: (d, v) => { d.audio.master = v; } },
        { kind: 'slider', label: 'Music', desc: 'Menu, draft and reveal music.', min: 0, max: 1, step: 0.05, fmt: pct, get: (s) => s.audio.music, set: (d, v) => { d.audio.music = v; } },
        { kind: 'slider', label: 'Sound effects', desc: 'Hits, cleats, whistles, the ball.', min: 0, max: 1, step: 0.05, fmt: pct, get: (s) => s.audio.sfx, set: (d, v) => { d.audio.sfx = v; } },
        { kind: 'slider', label: 'Crowd', desc: 'Stadium crowd and ambience.', min: 0, max: 1, step: 0.05, fmt: pct, get: (s) => s.audio.crowd, set: (d, v) => { d.audio.crowd = v; } },
        { kind: 'slider', label: 'Interface', desc: 'Menu sounds.', min: 0, max: 1, step: 0.05, fmt: pct, get: (s) => s.audio.ui, set: (d, v) => { d.audio.ui = v; } },
        { kind: 'toggle', label: 'Mute when unfocused', desc: 'Silence the game when you switch to another window or tab.', get: (s) => s.audio.muteUnfocused, set: (d, v) => { d.audio.muteUnfocused = v; } },
        { kind: 'action', label: 'Reset audio settings', desc: 'Restore the defaults on this tab.', run: () => nav.reset('audio') },
      ],
    },
    {
      id: 'gameplay',
      label: 'Gameplay',
      rows: [
        { kind: 'choice', label: 'Difficulty', desc: 'Changes how fast and how smart the Beasts react, never player ratings.', options: [{ value: 'rookie', label: 'Rookie' }, { value: 'pro', label: 'Pro' }, { value: 'legend', label: 'Legend' }, { value: 'beast', label: 'Beast' }], get: (s) => s.gameplay.difficulty, set: (d, v) => { d.gameplay.difficulty = v as Settings['gameplay']['difficulty']; } },
        { kind: 'choice', label: 'Game length', desc: 'How many offensive drives you get.', options: [{ value: 4, label: 'Quick · 4 drives' }, { value: 6, label: 'Standard · 6 drives' }, { value: 10, label: 'Full · 10 drives' }], get: (s) => s.gameplay.gameLength, set: (d, v) => { d.gameplay.gameLength = v as Settings['gameplay']['gameLength']; } },
        { kind: 'choice', label: 'Default camera', desc: 'The camera used for every snap.', options: [{ value: 'broadcast', label: 'Broadcast' }, { value: 'all22', label: 'All-22' }, { value: 'field', label: 'Field level' }], get: (s) => s.gameplay.camera, set: (d, v) => { d.gameplay.camera = v as Settings['gameplay']['camera']; } },
        { kind: 'choice', label: 'Lighting', desc: 'Time of day and weather at the Beasts\' stadium.', options: [{ value: 'golden', label: 'Golden Hour' }, { value: 'night', label: 'Night' }, { value: 'overcast', label: 'Overcast' }, { value: 'rain', label: 'Rain' }, { value: 'snow', label: 'Snow' }, { value: 'random', label: 'Random' }], get: (s) => s.gameplay.lighting, set: (d, v) => { d.gameplay.lighting = v as Settings['gameplay']['lighting']; } },
        { kind: 'toggle', label: 'Skip intros', desc: 'Go straight to the title screen on launch.', get: (s) => s.gameplay.skipIntros, set: (d, v) => { d.gameplay.skipIntros = v; } },
        { kind: 'toggle', label: 'Fast reveal', desc: 'Shorter Beasts walkout and draft presentation.', get: (s) => s.gameplay.fastReveal, set: (d, v) => { d.gameplay.fastReveal = v; } },
        { kind: 'choice', label: 'Automatic replays', desc: 'When instant replays play by themselves.', options: [{ value: 'on', label: 'All big plays' }, { value: 'big', label: 'Scores and turnovers' }, { value: 'off', label: 'Off' }], get: (s) => s.gameplay.autoReplay, set: (d, v) => { d.gameplay.autoReplay = v as Settings['gameplay']['autoReplay']; } },
        { kind: 'toggle', label: 'Big-hit slow motion', desc: 'The very biggest hits play in slow motion for a moment.', get: (s) => s.gameplay.bigHitSlowmo, set: (d, v) => { d.gameplay.bigHitSlowmo = v; } },
        { kind: 'action', label: 'Skin-tone editor', desc: 'Assign skin tones to every player and defender. Saved to the game data so they carry across sessions and devices.', run: nav.openEditor, value: 'Open ▸' },
        { kind: 'toggle', label: 'Slow first catch', desc: 'Your first catch of a session plays in slow motion while the ball is in the air, to learn the catch call.', get: (s) => s.gameplay.firstCatchSlowmo, set: (d, v) => { d.gameplay.firstCatchSlowmo = v; } },
        { kind: 'action', label: 'Reset gameplay settings', desc: 'Restore the defaults on this tab.', run: () => nav.reset('gameplay') },
      ],
    },
    {
      id: 'accessibility',
      label: 'Accessibility',
      rows: [
        { kind: 'choice', label: 'Colorblind receiver icons', desc: 'Adds shapes to receiver icons and switches to a palette that stays distinct for your color vision.', options: [{ value: 'off', label: 'Off' }, { value: 'deuteranopia', label: 'Deuteranopia' }, { value: 'protanopia', label: 'Protanopia' }, { value: 'tritanopia', label: 'Tritanopia' }], get: (s) => s.accessibility.colorblind, set: (d, v) => { d.accessibility.colorblind = v as Settings['accessibility']['colorblind']; } },
        { kind: 'choice', label: 'Caption size', desc: 'Size of commentary captions.', options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }], get: (s) => s.accessibility.captionSize, set: (d, v) => { d.accessibility.captionSize = v as Settings['accessibility']['captionSize']; } },
        { kind: 'toggle', label: 'Reduce camera shake', desc: 'Softens impact shake on big hits.', get: (s) => s.accessibility.reduceShake, set: (d, v) => { d.accessibility.reduceShake = v; } },
        { kind: 'toggle', label: 'Reduce flashing', desc: 'Tones down pyro, strobes, camera flashes and bloom pulses.', get: (s) => s.accessibility.reduceFlashing, set: (d, v) => { d.accessibility.reduceFlashing = v; } },
        { kind: 'toggle', label: 'Hold-to-toggle', desc: 'Sprint and protect-ball switch on and off instead of needing to be held.', get: (s) => s.accessibility.holdToToggle, set: (d, v) => { d.accessibility.holdToToggle = v; } },
        { kind: 'slider', label: 'Interface scale', desc: 'Size of menus and text.', min: 0.85, max: 1.3, step: 0.05, fmt: pct, get: (s) => s.accessibility.uiScale, set: (d, v) => { d.accessibility.uiScale = v; } },
        { kind: 'action', label: 'Reset accessibility settings', desc: 'Restore the defaults on this tab.', run: () => nav.reset('accessibility') },
      ],
    },
  ];
}

export function SettingsScreen() {
  const back = useApp((s) => s.back);
  const go = useApp((s) => s.go);
  const setShot = useApp((s) => s.setShot);
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const applyPreset = useSettings((s) => s.applyPreset);
  const reset = useSettings((s) => s.reset);
  const [tab, setTab] = useState(0);
  const [focus, setFocus] = useState(0);
  const [capturing, setCapturing] = useState<{ actionId: string; kind: 'kb' | 'pad' } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    setShot('settings');
  }, [setShot]);

  const tabs = useMemo(
    () =>
      buildTabs({
        openEditor: () => go('characterization'),
        applyPreset,
        reset,
        resetBinds: () => set((d) => {
          d.controls.keyboard = defaultBindings('kb');
          d.controls.gamepad = defaultBindings('pad');
        }),
      }),
    [go, applyPreset, reset, set],
  );
  const rows = tabs[tab]!.rows;
  const row = rows[focus];

  const changeTab = (d: number) => {
    Audio.uiTick();
    setTab((t) => (t + d + tabs.length) % tabs.length);
    setFocus(0);
    setConflict(null);
  };

  const adjust = (i: number, dir: number, repeat: boolean) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'toggle') {
      Audio.uiTick();
      set((d) => r.set(d, !r.get(settings)));
    } else if (r.kind === 'choice') {
      const idx = r.options.findIndex((o) => o.value === r.get(settings));
      const next = r.options[(idx + dir + r.options.length) % r.options.length]!.value;
      Audio.uiTick();
      set((d) => r.set(d, next));
      r.after?.(next);
    } else if (r.kind === 'slider') {
      const v = stepValue(r.get(settings), dir, r.min, r.max, r.step, repeat);
      if (v !== r.get(settings)) {
        Audio.uiTick();
        set((d) => r.set(d, v));
      }
    }
  };

  const startCapture = (actionId: string, kind: 'kb' | 'pad') => {
    if (ACTIONS_BY_ID.get(actionId)?.fixed) {
      Audio.uiError();
      return;
    }
    Audio.uiSelect();
    setCapturing({ actionId, kind });
    setConflict(null);
    // Safe to arm synchronously: the key that started capture has already been dispatched.
    Input.captureNext((code) => {
      setCapturing(null);
      if (!code) return;
      const isPad = code.startsWith('Pad:');
      if ((kind === 'pad') !== isPad) {
        Audio.uiError();
        setConflict(kind === 'pad' ? 'Press a gamepad button to bind the gamepad.' : 'Press a key or mouse button to bind the keyboard.');
        return;
      }
      const field = kind === 'kb' ? 'keyboard' : 'gamepad';
      const current = useSettings.getState().settings.controls[field];
      const clashes = findConflicts(current, actionId, code);
      set((d) => {
        const b = d.controls[field];
        for (const other of clashes) b[other] = (b[other] ?? []).filter((c) => c !== code);
        b[actionId] = [code, ...(b[actionId] ?? []).filter((c) => c !== code)].slice(0, 2);
      });
      Audio.uiSelect();
      if (clashes.length) setConflict(`${inputLabel(code)} was moved from ${clashes.map((c) => ACTIONS_BY_ID.get(c)?.label).join(', ')}.`);
    });
  };

  const confirm = (i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.kind === 'action') {
      Audio.uiSelect();
      r.run();
    } else if (r.kind === 'bind') startCapture(r.actionId, 'kb');
    else adjust(i, 1, false);
  };

  useMenuNav({
    count: rows.length,
    focus,
    setFocus,
    enabled: !capturing,
    isDisabled: (i) => rows[i]?.kind === 'header',
    onConfirm: confirm,
    onBack: back,
    onLeft: (i, rep) => adjust(i, -1, rep),
    onRight: (i, rep) => adjust(i, 1, rep),
    onTabPrev: () => changeTab(-1),
    onTabNext: () => changeTab(1),
    onAlt: (i) => {
      const r = rows[i];
      if (r?.kind === 'bind') startCapture(r.actionId, 'pad');
    },
    wrap: false,
  });

  // Keep the focused row in view inside the scrolling pane.
  useEffect(() => {
    document.querySelector('.settings-rows .is-focused')?.scrollIntoView({ block: 'nearest' });
  }, [focus, tab]);

  const desc = row ? (row.kind === 'bind' ? bindDesc(row.actionId) : row.kind === 'header' ? '' : row.desc) : '';

  return (
    <div className="menu-screen settings-screen">
      <div className="menu-scrim strong" />
      <header className="screen-head">
        <h1 className="screen-title">Settings</h1>
        <div className="tabs">
          <span className="tab-key">Q</span>
          {tabs.map((t, i) => (
            <button key={t.id} className={`tab ${i === tab ? 'is-active' : ''}`} onClick={() => { setTab(i); setFocus(0); Audio.uiTick(); }} tabIndex={-1}>
              {t.label}
            </button>
          ))}
          <span className="tab-key">E</span>
        </div>
      </header>
      <div className="settings-body">
        <div className="settings-rows">
          {rows.map((r, i) => {
            const f = i === focus;
            const hover = () => !capturing && r.kind !== 'header' && setFocus(i);
            switch (r.kind) {
              case 'header':
                return <div key={`h${i}`} className="setting-header">{r.label}</div>;
              case 'toggle':
                return (
                  <SettingRow key={r.label} label={r.label} focused={f} onHover={hover}>
                    <Toggle value={r.get(settings)} onChange={(v) => set((d) => r.set(d, v))} />
                  </SettingRow>
                );
              case 'choice':
                return (
                  <SettingRow key={r.label} label={r.label} focused={f} onHover={hover}>
                    <Choice value={r.get(settings)} options={r.options} onChange={(v) => { set((d) => r.set(d, v)); r.after?.(v); }} />
                  </SettingRow>
                );
              case 'slider':
                return (
                  <SettingRow key={r.label} label={r.label} focused={f} onHover={hover}>
                    <Slider value={r.get(settings)} min={r.min} max={r.max} step={r.step} format={r.fmt} onChange={(v) => set((d) => r.set(d, v))} />
                  </SettingRow>
                );
              case 'action':
                return (
                  <SettingRow key={r.label} label={r.label} focused={f} onHover={hover} onClick={() => confirm(i)}>
                    <span className="action-value">{r.value ?? 'Apply'}</span>
                  </SettingRow>
                );
              case 'bind': {
                const def = ACTIONS_BY_ID.get(r.actionId)!;
                const kb = settings.controls.keyboard[r.actionId] ?? [];
                const pad = settings.controls.gamepad[r.actionId] ?? [];
                const cap = capturing?.actionId === r.actionId ? capturing.kind : null;
                return (
                  <SettingRow key={r.actionId} label={def.label} focused={f} onHover={hover}>
                    <span className="binds">
                      <span className={`bind ${cap === 'kb' ? 'capturing' : ''}`} onClick={(e) => { e.stopPropagation(); setFocus(i); startCapture(r.actionId, 'kb'); }}>
                        {cap === 'kb' ? 'Press a key…' : kb.map(inputLabel).join(' / ') || '—'}
                      </span>
                      <span className={`bind pad ${cap === 'pad' ? 'capturing' : ''}`} onClick={(e) => { e.stopPropagation(); setFocus(i); startCapture(r.actionId, 'pad'); }}>
                        {cap === 'pad' ? 'Press a button…' : pad.map(inputLabel).join(' / ') || '—'}
                      </span>
                    </span>
                  </SettingRow>
                );
              }
            }
          })}
        </div>
        <aside className="settings-desc">
          <p>{desc}</p>
          {conflict ? <p className="conflict">{conflict}</p> : null}
        </aside>
      </div>
      <Hints
        items={
          tabs[tab]!.id === 'controls'
            ? [{ kb: 'Enter', pad: 'A', label: 'Rebind key' }, { kb: 'R', pad: 'Y', label: 'Rebind gamepad' }, { kb: 'Q / E', pad: 'LB / RB', label: 'Tabs' }, { kb: 'Esc', pad: 'B', label: 'Back' }]
            : [{ kb: '← →', pad: 'D-Pad', label: 'Change' }, { kb: 'Q / E', pad: 'LB / RB', label: 'Tabs' }, { kb: 'Esc', pad: 'B', label: 'Back' }]
        }
      />
    </div>
  );
}

function bindDesc(actionId: string): string {
  const def = ACTIONS_BY_ID.get(actionId);
  if (!def) return '';
  if (def.fixed) return `${def.label}. This one follows the mouse or stick and can't be rebound.`;
  return `${def.label} (${CONTEXT_LABELS[def.context]}). Enter rebinds the keyboard, R rebinds the gamepad. A key already used in the same context moves here.`;
}
