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
npm ci                                    # Node.js 22+
npx wrangler login                         # opens browser, free Cloudflare account

# 1. store the key(s) for whichever provider(s) you use — only the one matching
#    DEFAULT_PROVIDER is required, the others are optional
npx wrangler secret put GEMINI_API_KEY      # aistudio.google.com
npx wrangler secret put CEREBRAS_API_KEY    # cloud.cerebras.ai
npx wrangler secret put GROQ_API_KEY        # console.groq.com

# 2. validate locally, then deploy (creates the QUOTA Durable Object binding)
npm run type-check
npm run build                             # dry run; nothing is published
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

`X-Install-Id` is client-controlled, not authentication. Quotas are atomically
reserved in one SQLite Durable Object; rejected requests do not consume the
global budget. Each admitted generation request can try two providers. The
counter therefore measures client requests, not provider calls or tokens.
The `v1-quota` migration replaces the former KV implementation and starts a new
budget on its first deployment. Old KV data is not deleted by this change.

Each provider attempt has a 20-second timeout; two attempts fit within the
client's 45-second timeout. Bodies are limited to 256000 bytes, prompts to
60000 characters, output tokens to 16384. Browser preflight is supported;
public CORS is not an access-control mechanism.

Cerebras and Groq speak the OpenAI-compatible chat-completions dialect, so the
Worker folds Gemini's `responseJsonSchema` into the prompt text and asks for
generic JSON-object mode (`response_format: {type:"json_object"}`) for those
two. This adapter uses that common protocol; the app validates returned
sentences regardless of the provider's own schema capabilities.

## Watch traffic

```bash
npx wrangler tail
```
