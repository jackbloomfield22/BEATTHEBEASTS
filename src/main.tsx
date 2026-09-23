import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bungee/400.css';
import '@fontsource-variable/inter';
import './ui/styles/global.css';
import { App } from './app/App';

// Dev tools live on hash routes so they work on any deploy (TECH_PLAN §7):
//   #/dev/ratings   Ratings Explorer
//   #/dev/anim      Animation Lab
const AnimLab = lazy(() => import('./dev/anim/AnimLab').then((m) => ({ default: m.AnimLab })));
const RatingsExplorer = lazy(() => import('./dev/ratings/RatingsExplorer').then((m) => ({ default: m.RatingsExplorer })));

function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  if (hash.startsWith('#/dev/ratings')) {
    return (
      <Suspense fallback={<div className="rx-boot">Loading Ratings Explorer…</div>}>
        <RatingsExplorer />
      </Suspense>
    );
  }
  if (hash.startsWith('#/dev/anim')) {
    return (
      <Suspense fallback={<div className="rx-boot">Loading Animation Lab…</div>}>
        <AnimLab />
      </Suspense>
    );
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
