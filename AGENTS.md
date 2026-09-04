# Papanda app — notes for contributors

- **Expo SDK 54 / React Native 0.81.** Check the versioned docs at
  https://docs.expo.dev/versions/v54.0.0/ before using an Expo API.
- Single `zustand` store (`src/store/useStore.ts`), persisted to AsyncStorage.
  Only user data is persisted (`partialize`); the ~5 MB static word/sentence
  dataset stays in memory. Derived `words` / `sentences` are rebuilt by
  `initializeStore`, which runs from the persist `onRehydrateStorage` hook.
- AI (sentence generation + explanation) uses the Gemini API directly from the
  client. Key + model come from `EXPO_PUBLIC_GEMINI_API_KEY` /
  `EXPO_PUBLIC_GEMINI_MODEL`.
  - Local: `.env` (git-ignored).
  - **EAS builds: these are NOT read from `.env`.** Add both as EAS environment
    variables for the `preview` and `production` environments
    (`eas env:create` or the project dashboard), or AI features silently fail in
    release APKs.
