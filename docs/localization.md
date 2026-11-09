# Localization maintenance

The UI follows VS Code's display language. English is the source and fallback language; Simplified Chinese uses `zh-cn`. Switching languages requires the normal VS Code restart. Platform text and page-detection expressions must remain unchanged. Logs always use English.

Manifest text uses stable `%key%` references and the root `package.nls` catalogs. Host UI code uses `vscode.l10n.t`; Node-testable modules use `@vscode/l10n`. Activation initializes that package from `vscode.l10n.bundle` before creating services or view state. Do not evaluate localized messages at module scope.

After changing runtime text, run `pnpm run l10n:export`, update the Chinese runtime bundle, and run `pnpm run format`. Use complete messages with named placeholders. Keep placeholder names consistent across languages. WebViews receive only their display strings and locale; serialize script data with the existing escaping helper and update text through `textContent`.

`pnpm run lint` includes `pnpm run l10n:check`, one consolidated check for extracted messages, manifest references, translations, placeholders, and fallback. Existing unit and packaging tests cover rendering safety and packaged resources. To add a language, add both manifest and runtime catalogs and update the supported WebView locale mapping and the catalog check.

Logs use `Event description (snake_case_key: value).`, or `Event description.` without metadata, through `ExtensionLogger`. Use stable English codes and safe operational metadata, never translated messages or raw exceptions.
