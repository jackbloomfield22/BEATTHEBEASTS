import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// engine/ and sim/ must stay pure, deterministic TypeScript: no React, no three,
// no DOM, no wall clock, no Math.random. See CLAUDE.md.
const PURE_RESTRICTED_IMPORTS = {
  patterns: [
    { group: ['react', 'react-dom', 'react/*', 'three', 'three/*', '@react-three/*', 'postprocessing', 'n8ao', 'zustand', 'motion', '@dimforge/*'], message: 'engine/ and sim/ are pure TS: no React, three, UI state or physics imports.' },
    { group: ['@/render/*', '@/ui/*', '@/app/*', '@/audio/*', '@/input/*', '@/anim/*', '@/dev/*', '../render/*', '../ui/*'], message: 'engine/ and sim/ may not depend on presentation layers.' },
  ],
};
const PURE_RESTRICTED_SYNTAX = [
  { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Use the seeded RNG from engine/rng.' },
  { selector: "MemberExpression[object.name='Date'][property.name='now']", message: 'No wall clock in the sim.' },
  { selector: "MemberExpression[object.name='performance'][property.name='now']", message: 'No wall clock in the sim.' },
  { selector: "NewExpression[callee.name='Date']", message: 'No wall clock in the sim (pass dates in as strings).' },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'legacy', 'data/legacy/**', 'public', 'tools/shots/out', 'test-results', '.claude'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['tools/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
  {
    files: ['src/engine/**/*.ts', 'src/sim/**/*.ts'],
    ignores: ['**/*.test.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', PURE_RESTRICTED_IMPORTS],
      'no-restricted-syntax': ['error', ...PURE_RESTRICTED_SYNTAX],
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'performance', 'requestAnimationFrame'],
    },
  },
);
