/**
 * Documentation published by the Discord bot.
 * Each entry becomes a Discord embed and is kept in sync across restarts.
 * Public messages are written in English.
 */

function code(language, value) {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function siteLinks(site) {
  return `[Website](${site}) · [Dashboard](${site}/portal) · [Create account](${site}/signup)`;
}

export function channelDocs(key, site) {
  if (key === 'welcome') {
    return [
      {
        title: 'Welcome to VALARIA Gateway',
        description: [
          'One provider key stays on the server. Every user gets a derived key, quotas and usage tracking.',
          '',
          '**Two surfaces**',
          '`#api` — OpenAI- and Anthropic-compatible API for scripts and SDKs.',
          '`#valaria-code` — the coding agent in your terminal, with chat, diff and approvals.',
          '',
          '**Get started**',
          `1. Create your account: ${siteLinks(site)}`,
          '2. Open `#api` or `#valaria-code` depending on your workflow.',
          '3. Ask questions in `#support`.',
          '',
          '> Never share a full API key or a `vlt_…` device token in this server.',
        ].join('\n'),
        image: `${site}/assets/valaria-code.png`,
      },
      {
        title: 'Server rules',
        description: [
          '**Respect** — no insults, spam or unsolicited advertising.',
          '**Security** — never post keys, secrets or passwords.',
          '**Support** — include useful context: time, endpoint, error code.',
          '**Reports** — use `#reports` for incidents and abuse.',
          '',
          'Moderators may move or remove messages that break these rules.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'announcements') {
    return [
      {
        title: 'VALARIA announcements',
        description: [
          'This channel publishes updates about the website, the API and VALARIA Code.',
          '',
          '**Launch announcement**',
          'VALARIA Gateway is live in production. The landing page, dashboard, device login and coding agent are available.',
          '',
          `[Explore the website](${site}) · [Open dashboard](${site}/portal)`,
          '',
          'Announcements are locked. Please continue discussions in `#support`.',
        ].join('\n'),
        image: `${site}/assets/valaria-code-studio.png`,
      },
    ];
  }

  if (key === 'status') {
    return [
      {
        title: 'Service status',
        description: [
          'This channel shows the gateway status and is refreshed every five minutes.',
          '',
          'Public health endpoint: `GET /healthz`',
          `[Open website](${site})`,
          '',
          'If you notice an incident, open a message in `#reports` with the time and error message.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'general') {
    return [
      {
        title: 'General discussion',
        description: [
          'Welcome to the VALARIA community chat.',
          '',
          'For integration questions, use `#support`.',
          'For production incidents, use `#reports`.',
          '',
          `[Website](${site}) · [Dashboard](${site}/portal)`,
          'Never post API keys, secrets or device tokens here.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'support') {
    return [
      {
        title: 'VALARIA support',
        description: [
          'Ask your question with as much useful context as possible.',
          '',
          '**Please include**',
          '• date and time of the issue;',
          '• the client used (SDK, cURL, Codex, Claude Code, VALARIA Code);',
          '• the requested model;',
          '• the HTTP status code and error message;',
          '• your account name (never your full key).',
          '',
          '**Never include**',
          '• a full `sk-dsk-…` API key;',
          '• a `vlt_…` device token;',
          '• a password.',
          '',
          'We can help you revoke or rotate a key from the dashboard.',
        ].join('\n'),
      },
      {
        title: 'Quick troubleshooting',
        description: [
          `Check the service first: [Dashboard](${site}/portal) · [Website](${site})`,
          '',
          '**401** — missing or invalid key. Check the `Authorization: Bearer …` header.',
          '**403** — access disabled or pass expired. Open **My pass**.',
          '**429** — slow down and respect `Retry-After`.',
          '**402 / quota** — credit or quota exhausted. Check **Usage**.',
          '',
          'If the issue persists, include the exact error code and timestamp.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'api') {
    return [
      {
        title: 'API · connection',
        description: [
          `**OpenAI-compatible URL**\n\`${site}/v1\`\n\n**Anthropic Messages URL**\n\`${site}/anthropic\``,
          '',
          '**Authentication**',
          'Personal `sk-dsk-…` key created in **Dashboard → API keys**.',
          'The full key is shown once; it can be revoked and rotated.',
          '',
          '```http\nAuthorization: Bearer YOUR_API_KEY\nContent-Type: application/json\n```',
          '',
          'For Anthropic: `x-api-key: YOUR_API_KEY` and `anthropic-version: 2023-06-01`.',
          `[Integration guide](${site}/portal)`,
        ].join('\n'),
      },
      {
        title: 'First request · cURL',
        description: [
          code('bash', `curl ${site}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-opus-5.5",
    "messages": [{"role":"user","content":"Hello"}]
  }'`),
          '',
          'Standard OpenAI response format. Add `"stream": true` for SSE.',
        ].join('\n'),
      },
      {
        title: 'First request · Node.js and Python',
        description: [
          '**Node.js — OpenAI SDK**',
          code('js', `import OpenAI from "openai";
const client = new OpenAI({
  apiKey: "YOUR_API_KEY",
  baseURL: "${site}/v1"
});
const res = await client.chat.completions.create({
  model: "claude-opus-5.5",
  messages: [{ role: "user", content: "Hello" }]
});
console.log(res.choices[0].message.content);`),
          '',
          '**Python — OpenAI SDK**',
          code('python', `from openai import OpenAI
client = OpenAI(api_key="YOUR_API_KEY", base_url="${site}/v1")
res = client.chat.completions.create(
    model="claude-opus-5.5",
    messages=[{"role":"user","content":"Hello"}]
)
print(res.choices[0].message.content)`),
        ].join('\n'),
      },
      {
        title: 'Endpoints, models and limits',
        description: [
          '**Endpoints**',
          '`POST /v1/chat/completions` — text/code chat, optional SSE streaming.',
          '`GET /v1/models` — models available to your key.',
          '`POST /anthropic/v1/messages` — Anthropic Messages protocol.',
          '',
          '**Exposed models**',
          '`claude-opus-5.5` · `claude-opus-5` · `fable-5.1` · `fable-5` · `gpt-5` · `deepseek-flash`',
          '',
          '**Quota headers**',
          '`x-quota-tokens-remaining` · `x-quota-requests-remaining` · `x-quota-usd-remaining`',
          '',
          '**Common errors**',
          '`401` missing/invalid key · `403` access or pass disabled · `404` unknown model/route · `429` rate limited · `402` quota/credit exhausted.',
          '',
          `[Full guide](${site}/portal)`,
        ].join('\n'),
      },
    ];
  }

  if (key === 'valaria-code') {
    return [
      {
        title: 'VALARIA Code · installation',
        description: [
          'The coding agent in your terminal. Device login means no full API key is pasted into the terminal.',
          '',
          '**Prerequisite**: Node.js 20+.',
          code('bash', 'npm install -g valaria-code\nvalaria login\nvalaria'),
          '',
          'After `valaria login`, the browser opens `/device`. Sign in, verify the code, approve it and choose **Claude**, **Codex** or **DeepSeek**.',
          '',
          `[CLI guide](${site}/portal) · [Website](${site})`,
        ].join('\n'),
        image: `${site}/assets/valaria-code-splash.png`,
      },
      {
        title: 'Interface and commands',
        description: [
          '**Layouts**',
          '`Focus` — conversation + permanent diff.',
          '`Studio` — account, quotas, conversation and diff.',
          '`Compact` — account summary.',
          '',
          'Inside the TUI:',
          '`/help` help · `/files` project files · `/read` context · `/edit` patch · `/run` command',
          '`/models` · `/model` · `/usage` · `/account` · `/layout` · `/diff`',
          '`/interview` · `/plan` · `/review`',
          '',
          '`PgUp/PgDn` scroll history · `Ctrl+O` account · `Ctrl+P` layout.',
        ].join('\n'),
        image: `${site}/assets/valaria-code-focus.png`,
      },
      {
        title: 'Diff and approval modes',
        description: [
          'The diff stays visible in the right column: changed files at the top, `+`/`−` lines below.',
          '',
          '**Modes**',
          '`Strict` — every write and command asks for `y`/`n`.',
          '`Guarded` — approval only for sensitive files and dangerous commands.',
          '`Full access` — no approval.',
          '',
          'Shortcuts:',
          '`/1` Strict · `/2` Guarded · `/3` Full access',
          '`Ctrl+G` or `Alt+M` cycles modes.',
          '',
          'An approval shows the patch, then accepts `y` or rejects with `n`.',
        ].join('\n'),
        image: `${site}/assets/valaria-code-diff.png`,
      },
      {
        title: 'Security and troubleshooting',
        description: [
          '**Security**',
          '• device token `vlt_…` hashed on the server and revocable;',
          '• local config `~/.valaria/code.json` is `0600`;',
          '• writes are confined to the project directory;',
          '• approval is required before writes/commands depending on mode.',
          '',
          '**Troubleshooting**',
          '`valaria login` cannot find the page → check network and dashboard URL.',
          'Token expired or revoked → `valaria logout` then `valaria login`.',
          'Empty diff → no Git changes, or run `/diff` to refresh.',
          'Too many approvals → use `/2` or `/3` knowingly.',
          '',
          'Never publish your token in Discord.',
        ].join('\n'),
        image: `${site}/assets/valaria-code-approval.png`,
      },
    ];
  }

  if (key === 'reports') {
    return [
      {
        title: 'Report an incident',
        description: [
          'Use this channel for production incidents, abuse or billing errors.',
          '',
          '**Message template**',
          '```\nDate and time:\nEndpoint / client:\nRequested model:\nHTTP status:\nError message:\nAccount name (not the key):\n```',
          '',
          'Never publish a full API key, a `vlt_…` token or any secret.',
          'Staff may ask you to revoke the key from **Settings → Connected devices** or **API keys**.',
          '',
          `[Dashboard](${site}/portal) · [Website](${site})`,
        ].join('\n'),
      },
    ];
  }

  return [
    {
      title: 'VALARIA Gateway',
      description: `${siteLinks(site)}\n\nUse \`#support\` for questions.`,
    },
  ];
}
