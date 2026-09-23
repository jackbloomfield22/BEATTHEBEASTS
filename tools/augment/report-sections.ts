// Tool-owned sections of docs/AUGMENT_REPORT.md. Each augmentation tool
// (arm.ts, fumbles.ts, forty.ts, added-stints) writes its own section between
// markers; tools/augment/build.ts rewrites the rest of the report and keeps
// every marked section.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const beginMarker = (tool: string): string => `<!-- BEGIN ${tool} -->`;
export const endMarker = (tool: string): string => `<!-- END ${tool} -->`;

/** Every marked section in the report text, in order, each ending with a newline. */
export function markedSections(text: string): string[] {
  const out: string[] = [];
  const re = /<!-- BEGIN (tools\/[\w./-]+) -->[\s\S]*?<!-- END \1 -->/g;
  for (const m of text.matchAll(re)) out.push(`${m[0]}\n`);
  return out;
}

/** Replace (or append) one tool's section of the report. */
export function writeMarkedSection(report: string, tool: string, lines: readonly string[]): void {
  const block = `${beginMarker(tool)}\n${lines.join('\n')}\n${endMarker(tool)}\n`;
  const old = existsSync(report) ? readFileSync(report, 'utf8') : '';
  const a = old.indexOf(beginMarker(tool));
  const b = old.indexOf(endMarker(tool));
  const next = a >= 0 && b > a ? `${old.slice(0, a)}${block}${old.slice(b + endMarker(tool).length).replace(/^\n/, '')}` : `${old.replace(/\n*$/, '\n\n')}${block}`;
  writeFileSync(report, next);
}
