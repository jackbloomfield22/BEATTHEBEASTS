import { Stage } from '@/render/Stage';
import { initSettings, defaultSettings } from './settings';
import { defaultBindings } from '@/input/actions';
import { useApp, type CameraShot } from './appStore';
import { urlFlags } from './platform';

initSettings(() => defaultSettings(defaultBindings('kb'), defaultBindings('pad')));
if (urlFlags.shot) useApp.setState({ shot: urlFlags.shot as CameraShot });
useApp.subscribe((s) => {
  if (s.sceneReady) (window as unknown as { __btbReady?: boolean }).__btbReady = true;
});

export function App() {
  return <Stage />;
}
