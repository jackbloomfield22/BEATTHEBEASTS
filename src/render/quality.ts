import type { QualityPreset } from '@/app/settings';

// First-launch quality guess from the GPU name (TECH_PLAN §5.11). Milestone 3
// adds the in-scene benchmark that refines this by one tier either way.
export function guessQuality(gpu: string): QualityPreset {
  const g = gpu.toLowerCase().replace(/\((r|tm)\)/g, '');
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(g)) return 'low';
  if (/rtx\s?(40|50)\d\d|rx\s?(7|9)\d{3}|radeon pro w|apple m\d (max|ultra)/.test(g)) return 'ultra';
  if (/rtx|gtx\s?16|gtx\s?10(7|8)0|rx\s?6\d{3}|apple m\d pro|apple m[3-9]/.test(g)) return 'high';
  if (/apple|intel.*(iris xe|arc)|radeon graphics|gtx|rx\s?5\d{2}/.test(g)) return 'medium';
  if (/intel/.test(g)) return 'low';
  return 'medium';
}
