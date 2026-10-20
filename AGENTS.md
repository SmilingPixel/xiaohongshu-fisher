# Repository Guidance

**Xiaohongshu Fisher** is a TypeScript VS Code extension. Follow the VS Code Extension API, existing module boundaries, and designs in `docs/`.

## Package Management

- Use **pnpm** for dependencies, scripts, tests, and packaging; do not use npm or yarn. Commit `pnpm-lock.yaml` with dependency changes.
- Prefer the scripts in `package.json`; use `pnpm run watch` for development.

## Code Style and Readability

- Use **Prettier** for formatting and **ESLint** for code quality. Follow `.prettierrc.json` and `.editorconfig`; avoid duplicating their rules here or adding competing formatters.
- Put each statement on its own line, use braces and multiline blocks for control flow, and separate methods and logical phases with blank lines.
- Avoid nested ternaries and dense conditions. Prefer named values, early returns, and focused helpers; keep shared state definitions in their owning module.
- Preserve branch precedence, cancellation checks, and cleanup order when refactoring. Explain module responsibilities and non-obvious lifecycle, pagination, security, or recovery behavior; avoid comments that repeat the code.
- Mark complete WebView templates with `/* HTML */` for formatting. Review embedded scripts manually because ESLint does not inspect template contents.
- Use `import type` for type-only dependencies and explicit types at module boundaries. Scope necessary lint exceptions to the relevant line and explain them.
- Use `pnpm run format` to format, `pnpm run format:check` to check, and `pnpm run lint:fix` to apply automatic fixes. Resolve remaining diagnostics rather than suppressing them.

## Documentation

- Write `README.md` in Chinese. Write code, identifiers, comments, diagnostics, and other developer documentation in English; product text may be localized.
- Update comments and documentation when behavior changes; keep explanations concise and accurate.

## Extension Architecture

- Declare commands, views, menus, settings, and activation behavior in `package.json`; prefix command IDs with `xiaohongshu-fisher.`.
- Keep activation lightweight and browser/network work lazy. Dispose listeners, providers, panels, and processes through `ExtensionContext.subscriptions` or explicit cleanup.
- Separate orchestration, views, platform access, sessions, and WebView rendering. Normalize platform responses into internal models; keep parsing and network access out of TreeDataProviders and command callbacks.
- Use VS Code APIs for interaction, configuration, storage, external links, and progress. Respect cancellation, prevent duplicate concurrent loads, and preserve existing view state on refresh or pagination failure.

## Security and Logging

- Store secrets in VS Code `SecretStorage` and session data in an extension-owned profile with user-controlled cleanup. Never expose credentials, cookies, profiles, tokens, or signatures in workspace settings or WebViews.
- Treat platform content and URLs as untrusted: escape rendered content, validate links, enforce a restrictive CSP, and never load remote WebView scripts.
- Use the existing `ExtensionLogger` and output channel, with structured English messages. Never log secrets, QR data, response bodies, personal content, or sensitive URL query parameters; do not add `console` logging or another logger.
- Do not add credential collection, automated posting/commenting, CAPTCHA bypass, fingerprint spoofing, or mechanisms that evade platform controls.

## Validation

- Add or update tests for meaningful behavior changes, especially pagination, sessions, parsing, and WebView messages. Use the VS Code test harness for extension-host behavior.
- After code changes, run `pnpm run compile`, `pnpm run lint` (ESLint plus formatting, no warnings), and relevant tests. `pnpm test` also runs compilation and lint first. Report checks that could not run.
