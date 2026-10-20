import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import typescriptEslint from 'typescript-eslint';

export default defineConfig([
	globalIgnores(['out/**', '.vscode-test/**', 'tmp/**']),
	{
		files: ['**/*.mjs', 'src/**/*.ts'],
		extends: [js.configs.recommended],
		rules: {
			eqeqeq: ['error', 'always'],
			'no-console': 'error',
			'no-nested-ternary': 'error',
			'no-throw-literal': 'error',
		},
	},
	{
		files: ['src/**/*.ts'],
		extends: [typescriptEslint.configs.recommended],
		rules: {
			'@typescript-eslint/naming-convention': [
				'error',
				{ selector: 'import', format: ['camelCase', 'PascalCase'] },
			],
			'@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	// Formatting belongs to Prettier; keep conflicting ESLint rules disabled.
	prettier,
	{
		files: ['**/*.mjs', 'src/**/*.ts'],
		// Prettier's preset disables curly, but requiring braces everywhere is compatible with it.
		rules: { curly: ['error', 'all'] },
	},
]);
