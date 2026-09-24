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
      // An effect's return value is its cleanup. A concise arrow returns
      // whatever its expression returns (scrollTo now returns a Promise in
      // Chrome), so every effect body must be a block.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression[body.type!='BlockStatement'][body.type!='ArrowFunctionExpression']",
          message: 'Give effects a block body (or return a cleanup arrow): a concise arrow returns its value, and React calls it as the cleanup.',
        },
      ],
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
  {
    // The real-time sim must give the same bits in every browser (TECH_PLAN
    // §4.4): transcendental functions go through engine/math/detmath, and `**`
    // (Math.pow semantics) is out. (The legacy port keeps legacy's Math.* on purpose.)
    files: ['src/sim/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PURE_RESTRICTED_SYNTAX,
        { selector: "MemberExpression[object.name='Math'][property.name=/^(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|cbrt|hypot|sinh|cosh|tanh)$/]", message: 'Not bit-identical across engines: use engine/math/detmath.' },
        { selector: "BinaryExpression[operator='**']", message: '`**` is Math.pow: write the product, or use detmath.pow.' },
        { selector: "AssignmentExpression[operator='**=']", message: '`**` is Math.pow: write the product, or use detmath.pow.' },
      ],
    },
  },
);
