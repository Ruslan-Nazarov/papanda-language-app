# papanda-gemini-proxy

Cloudflare Worker that hides the Gemini API key from the app and rate-limits
per install. The app calls `POST /v1/generate` with an `X-Install-Id` header
and `{ prompt, generationConfig }` body; the Worker forwards to Gemini with the
real key (held as a Worker secret).

## One-time setup

```bash
cd gemini-proxy
npm install
npx wrangler login                         # opens browser, free Cloudflare account

# 1. create the rate-limit KV store, paste the printed id into wrangler.toml
npx wrangler kv namespace create RL

# 2. store the Gemini key (get a fresh restricted one from aistudio.google.com)
npx wrangler secret put GEMINI_API_KEY

# 3. deploy
npx wrangler deploy
```

Deploy prints the URL, e.g. `https://papanda-gemini-proxy.<you>.workers.dev`.
Put `https://.../v1/generate` into the app:

- local dev: `EXPO_PUBLIC_GEMINI_PROXY_URL` in `papanda-app/.env`
- builds: `eas env:create --environment preview --name EXPO_PUBLIC_GEMINI_PROXY_URL --value https://.../v1/generate`
  (and again for `production`)

## Tuning

Limits are plain vars in `wrangler.toml` (`PER_INSTALL_HOURLY`, `PER_INSTALL_DAILY`,
`GLOBAL_DAILY`) and the model is `GEMINI_MODEL` — change and `npx wrangler deploy`,
no app release needed. `GLOBAL_DAILY` is the safety net against a leaked/abused
install id draining the free-tier quota.

## Watch traffic

```bash
npx wrangler tail
```
