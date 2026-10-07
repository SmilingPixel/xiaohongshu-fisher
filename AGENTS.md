# Repository Guidance

This repository contains **Xiaohongshu Fisher**, a Visual Studio Code extension written in TypeScript. Follow the VS Code Extension API and Extension Guidelines, and keep changes consistent with the existing project structure and the design documents in `docs/`.

## Package Management

- Use **pnpm** for dependency installation, scripts, tests, and packaging. Do not use npm or yarn for routine project work.
- Use `pnpm install` to install dependencies and `pnpm add` / `pnpm add -D` to add runtime or development dependencies.
- Keep `pnpm-lock.yaml` synchronized with dependency changes and include it in the same change.
- Prefer the scripts declared in `package.json`:
  - `pnpm run compile` for TypeScript compilation.
  - `pnpm run lint` for linting.
  - `pnpm test` for extension tests (the pretest hook compiles and lints first).
  - `pnpm run watch` for local development.

## VS Code Extension Conventions

- Declare user-facing commands, views, menus, configuration, and activation behavior in `package.json` contributions. Keep command IDs namespaced with `xiaohongshu-fisher.`.
- Keep activation lightweight. Initialize services when needed, avoid unnecessary network or browser work during activation, and dispose event listeners, providers, panels, processes, and other resources through `ExtensionContext.subscriptions` or an explicit `deactivate` cleanup path.
- Separate extension-host orchestration, view presentation, content-source/platform access, session management, and WebView rendering. Do not put platform parsing or network access directly in TreeDataProviders or command callbacks.
- Use VS Code APIs for user interaction, configuration, secrets, logging, external links, and progress reporting instead of implementing parallel UI or storage mechanisms.
- Respect cancellation and avoid duplicate concurrent loads. Preserve existing view state when a refresh or next-page request fails.

## Security and Privacy

- Treat cookies, browser profiles, authentication tokens, request signatures, and personal content as sensitive. Never log them, place them in workspace settings, or send them to WebViews.
- Store user secrets with VS Code `SecretStorage`; keep browser session data in an extension-owned local profile with a clear user-controlled cleanup path.
- Treat content and URLs from the platform as untrusted input. Escape or sanitize rendered content, validate links, and use a restrictive Content Security Policy for WebViews. Do not load remote scripts into a WebView.
- Do not add credential collection, automated posting/commenting, CAPTCHA bypass, fingerprint spoofing, or other mechanisms designed to evade platform controls.

## TypeScript and Tests

- Keep TypeScript types explicit at module boundaries. Normalize platform-specific responses into internal models before passing data to views or WebViews.
- Prefer small, focused modules and follow established formatting, naming, and error-handling patterns in the codebase.
- Add or update tests for meaningful behavior changes, especially pagination, session handling, parsing, and WebView message validation. Use the VS Code extension test harness for extension-host behavior.
- Before finishing code changes, run the relevant pnpm checks and report any checks that could not run.
