# papanda-ai-proxy

Cloudflare Worker that hides AI provider API keys from the app and rate-limits
per install. The app calls `POST /v1/generate` with an `X-Install-Id` header
and `{ prompt, generationConfig, provider? }` body; the Worker forwards to
whichever provider is configured — **Gemini**, **Cerebras**, or **Groq** —
with the real key (held as a Worker secret). The response is always `{ text }`
regardless of provider, so the app code never needs to know which one answered.

`provider` in the request body is optional and only meant for per-call
overrides (e.g. a specific feature always wants the strongest model); when
omitted, the Worker uses `DEFAULT_PROVIDER` from `wrangler.toml`.

## One-time setup

```bash
cd gemini-proxy
npm install
npx wrangler login                         # opens browser, free Cloudflare account

# 1. create the rate-limit KV store, paste the printed id into wrangler.toml
npx wrangler kv namespace create RL

# 2. store the key(s) for whichever provider(s) you use — only the one matching
#    DEFAULT_PROVIDER is required, the others are optional
npx wrangler secret put GEMINI_API_KEY      # aistudio.google.com
npx wrangler secret put CEREBRAS_API_KEY    # cloud.cerebras.ai
npx wrangler secret put GROQ_API_KEY        # console.groq.com

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
`GLOBAL_DAILY`). Provider and model are also plain vars — `DEFAULT_PROVIDER`
(`gemini` | `cerebras` | `groq`), `GEMINI_MODEL`, `CEREBRAS_MODEL`, `GROQ_MODEL` —
change and `npx wrangler deploy`, no app release needed. `GLOBAL_DAILY` is the
safety net against a leaked/abused install id draining the free-tier quota.

Cerebras and Groq speak the OpenAI-compatible chat-completions dialect, so the
Worker folds Gemini's `responseJsonSchema` into the prompt text and asks for
generic JSON-object mode (`response_format: {type:"json_object"}`) for those
two — there's no native JSON-Schema-constrained decoding on their APIs, so the
app's existing sentence validation is the real safety net either way.

## Watch traffic

```bash
npx wrangler tail
```
