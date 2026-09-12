# Papanda app — notes for contributors

- **Expo SDK 54 / React Native 0.81.** Check the versioned docs at
  https://docs.expo.dev/versions/v54.0.0/ before using an Expo API.
- Single `zustand` store (`src/store/useStore.ts`), persisted to AsyncStorage.
  Only user data is persisted (`partialize`); the ~5 MB static word/sentence
  dataset stays in memory. Derived `words` / `sentences` are rebuilt by
  `initializeStore`, which runs from the persist `onRehydrateStorage` hook.
- AI (sentence generation + explanation + word audit) goes through a Cloudflare
  Worker proxy — `gemini-proxy/` — that holds the provider API key(s)
  server-side and rate-limits per install. The Worker can forward to **Gemini**,
  **Cerebras**, or **Groq** — all OpenAI-compatible chat APIs except
  Gemini get their prompt/schema folded into a chat message, see
  `gemini-proxy/README.md`. The app only knows `EXPO_PUBLIC_GEMINI_PROXY_URL`
  (not a secret). `isGeminiConfigured()` = "is the proxy URL set". The app
  attaches an `X-Install-Id` header from `src/services/installId.ts`.
  - Local: `.env` (git-ignored) → the workers.dev URL.
  - **EAS builds don't read `.env`** — add `EXPO_PUBLIC_GEMINI_PROXY_URL` as an
    EAS environment variable for `preview` and `production`.
  - Provider + model + rate limits are Worker config (`gemini-proxy/wrangler.toml`,
    `DEFAULT_PROVIDER` / `GEMINI_MODEL` / `CEREBRAS_MODEL` / `GROQ_MODEL`) —
    changeable without an app release. `generateGeminiText()` in
    `src/services/geminiClient.ts` also accepts an optional per-call `provider`
    override if a specific feature should always use a specific one.
- With no proxy URL, all AI features cleanly no-op and the Sentence Trainer runs
  on the ~170 seed sentences in `src/data/sentences.json`.
