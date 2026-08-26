import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'dist/**',
      '.vercel/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        Chart: 'readonly',
        html2canvas: 'readonly',
        jspdf: 'readonly'
      }
    },
    rules: {
      'no-console': 'off',
      'no-case-declarations': 'warn',
      'no-empty': 'warn',
      'no-unreachable': 'warn',
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  }
];
