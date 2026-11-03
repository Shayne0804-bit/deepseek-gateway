import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startGateway } from '../src/app.js';

const ADMIN_PASSWORD = 'test-password-123';
const ORIGINAL_KEY = 'sk-original-test';
const CHAT_USAGE = {
  prompt_tokens: 8,
  completion_tokens: 4,
  total_tokens: 12,
  prompt_cache_hit_tokens: 0,
  prompt_cache_miss_tokens: 8,
};

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function createMockUpstream() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });

    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash' }] }));
      return;
    }

    if (req.headers.authorization !== `Bearer ${ORIGINAL_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid upstream auth', type: 'authentication_error' } }));
      return;
    }

    if (body.delay_ms) {
      await new Promise((resolve) => setTimeout(resolve, Number(body.delay_ms)));
    }

    // Endpoint Anthropic de DeepSeek (utilise par Claude Code).
    if (req.url.startsWith('/anthropic/v1/messages')) {
      const anthropicUsage = { input_tokens: 20, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, usage: { input_tokens: 20, output_tokens: 0 } } })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bonjour' } })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: 'Bonjour' }],
        stop_reason: 'end_turn',
        usage: anthropicUsage,
      }));
      return;
    }

    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.write(`data: ${JSON.stringify({ id: 'c1', model: body.model, choices: [{ delta: { content: 'Bonjour' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'c1', model: body.model, choices: [{ delta: { content: ' à toi' } }] })}\n\n`);
      res.write(
        `data: ${JSON.stringify({
          id: 'c1',
          model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: CHAT_USAGE,
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: body.model ?? 'deepseek-flash',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: CHAT_USAGE,
        echo_max_tokens: body.max_tokens ?? null,
      }),
    );
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, seen });
    });
  });
}

let mock;
let gateway;
let base;
let cookie;
let tempDir;

async function api(pathname, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  let payload;
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') requestHeaders['x-requested-with'] = 'dsk-admin';
  if (cookie) requestHeaders.cookie = cookie;
  const res = await fetch(base + pathname, { method, headers: requestHeaders, body: payload });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { res, status: res.status, data };
}

async function login(password) {
  return fetch(`${base}/admin/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
    body: JSON.stringify({ password }),
  });
}

async function createClient(payload) {
  const { status, data } = await api('/admin/api/clients', { method: 'POST', body: payload });
  assert.equal(status, 201, JSON.stringify(data));
  return data;
}

async function getClient(clientId) {
  const { data } = await api('/admin/api/clients');
  return data.clients.find((c) => c.id === clientId);
}

async function proxyChat(key, body = {}, options = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify({
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'salut' }],
    ...body,
  });
  return fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...options.headers },
    body: payload,
  });
}

before(async () => {
  mock = await createMockUpstream();
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gateway-test-'));
  gateway = await startGateway({
    dataDir: tempDir,
    host: '127.0.0.1',
    port: 0,
    // Isolation : ignore le HTTPS eventuellement configure dans le .env local.
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: ORIGINAL_KEY,
    providerBaseUrl: mock.url,
    adminPassword: ADMIN_PASSWORD,
    logLevel: 'error',
    logger: silentLogger,
  });
  base = gateway.url;
  const res = await login(ADMIN_PASSWORD);
  assert.equal(res.status, 200);
  cookie = res.headers.getSetCookie()[0].split(';')[0];
  assert.ok(cookie.startsWith('dsk_admin='));
});

after(async () => {
  await gateway.close();
  await new Promise((resolve) => {
    mock.server.close(resolve);
    mock.server.closeAllConnections?.();
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('healthz repond et voit la cle fournisseur', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.providerConfigured, true);
});

test('les trois surfaces web sont servies : site public, console admin, espace utilisateur', async () => {
  const landing = await fetch(`${base}/`);
  assert.equal(landing.status, 200);
  assert.match(landing.headers.get('content-type'), /text\/html/);
  const landingHtml = await landing.text();
  assert.match(landingHtml, /VALARIA Gateway API/);
  assert.match(landingHtml, /partagée sous contrôle/);

  const admin = await fetch(`${base}/admin`);
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /Console d'administration/);

  const portal = await fetch(`${base}/portal`);
  assert.equal(portal.status, 200);
  assert.match(await portal.text(), /Mon espace/);

  const robots = await fetch(`${base}/robots.txt`);
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /Disallow: \//);
});

test('les assets texte sont servis compresses (gzip) avec cache navigateur', async () => {
  const res = await new Promise((resolve, reject) => {
    http.get(`${base}/assets/styles.css`, { headers: { 'accept-encoding': 'gzip' } }, (response) => {
      response.resume();
      resolve(response);
    }).on('error', reject);
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
  assert.match(String(res.headers['cache-control']), /max-age=300/);
  assert.match(String(res.headers['vary']), /accept-encoding/i);
});

test('l API admin exige une session', async () => {
  const res = await fetch(`${base}/admin/api/clients`);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'unauthorized');
});

test('mauvais mot de passe admin refuse', async () => {
  const res = await login('mauvais-mot-de-passe');
  assert.equal(res.status, 401);
});

test('API sans cle derivee -> 401', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-flash', messages: [] }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'missing_api_key');
});

test('cle derivee inconnue -> 401', async () => {
  const res = await proxyChat('sk-dsk-inconnue');
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error.code, 'invalid_api_key');
});

test('creation d une cle derivee : la cle complete n est affichee qu une fois', async () => {
  const data = await createClient({ name: 'Ami quota tokens', quotaTokens: 30, quotaRequests: 5, period: 'total' });
  assert.match(data.key, /^sk-dsk-[A-Za-z0-9_-]{20,}$/);
  assert.ok(data.client.keyPrefix.startsWith('sk-dsk-'));
  assert.equal(data.client.quotaTokens, 30);
  assert.equal(data.client.status, 'ok');

  const { data: list } = await api('/admin/api/clients');
  assert.ok(!JSON.stringify(list).includes(data.key), 'la cle complete ne doit jamais etre relue');
});

test('proxy non-streaming : usage, entete quota et cle originale bien transmise', async () => {
  const { key } = await createClient({ name: 'Ami quotas', quotaTokens: 30, period: 'total' });
  const before = mock.seen.length;
  const res = await proxyChat(key);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-quota-tokens-remaining'), '30');
  const body = await res.json();
  assert.equal(body.usage.total_tokens, 12);
  assert.ok(mock.seen.length > before);
  assert.equal(mock.seen.at(-1).auth, `Bearer ${ORIGINAL_KEY}`);
  assert.equal(mock.seen.at(-1).url, '/v1/chat/completions');

  const clients = (await api('/admin/api/clients')).data.clients;
  const client = clients.find((c) => c.name === 'Ami quotas');
  assert.equal(client.usedTokens, 12);
  assert.equal(client.usedRequests, 1);
  assert.equal(client.todayTokens, 12);
  assert.ok(client.usedUsd > 0);
});

test('quota de tokens applique (30 tokens = 3 requetes de 12)', async () => {
  const { client, key } = await createClient({ name: 'Ami quota strict', quotaTokens: 30, period: 'total' });
  for (let i = 0; i < 3; i += 1) {
    const res = await proxyChat(key);
    assert.equal(res.status, 200, `requete ${i + 1}`);
    await res.text();
  }
  const updated = await getClient(client.id);
  assert.equal(updated.usedTokens, 36);
  assert.equal(updated.exhausted, true);

  const blocked = await proxyChat(key);
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error.code, 'insufficient_quota');
  assert.match(body.error.message, /Quota de tokens epuise/);
});

test('quota de requetes applique', async () => {
  const { key } = await createClient({ name: 'Ami quota requetes', quotaRequests: 2, period: 'total' });
  for (let i = 0; i < 2; i += 1) {
    const res = await proxyChat(key);
    assert.equal(res.status, 200);
    await res.text();
  }
  const blocked = await proxyChat(key);
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error.code, 'insufficient_quota');
  assert.match(body.error.message, /Quota de requetes epuise/);
});

test('limite requetes/minute appliquee', async () => {
  const { key } = await createClient({ name: 'Ami rpm', rpmLimit: 2, period: 'total' });
  for (let i = 0; i < 2; i += 1) {
    const res = await proxyChat(key);
    assert.equal(res.status, 200);
    await res.text();
  }
  const blocked = await proxyChat(key);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  const body = await blocked.json();
  assert.equal(body.error.code, 'rate_limit_exceeded');
});

test('limite de requetes simultanees appliquee', async () => {
  const { key } = await createClient({ name: 'Ami concurrence', concurrencyLimit: 1, period: 'total' });
  const first = proxyChat(key, { delay_ms: 250 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const second = await proxyChat(key);
  assert.equal(second.status, 429);
  const body = await second.json();
  assert.equal(body.error.code, 'concurrency_limit_exceeded');
  const firstRes = await first;
  assert.equal(firstRes.status, 200);
  await firstRes.text();
});

test('streaming SSE transmis et comptabilise', async () => {
  const { client, key } = await createClient({ name: 'Ami streaming', period: 'total' });
  const res = await proxyChat(key, { stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /Bonjour/);
  assert.match(text, /data: \[DONE\]/);

  const updated = await getClient(client.id);
  assert.equal(updated.usedTokens, 12);
  const { data: logs } = await api(`/admin/api/clients/${client.id}/logs`);
  assert.equal(logs.rows[0].streamed, true);
  assert.equal(logs.rows[0].totalTokens, 12);
});

test('liste de modeles autorises appliquee (facturation flash forcee)', async () => {
  const { key } = await createClient({
    name: 'Ami modele',
    allowedModels: ['claude-opus-5.5'],
    period: 'total',
  });
  // Ni flash ni le modele demande ne sont autorises -> refus.
  const denied = await proxyChat(key, { model: 'deepseek-v4-pro' });
  assert.equal(denied.status, 403);
  const body = await denied.json();
  assert.equal(body.error.code, 'model_not_allowed');

  // L'alias autorise passe, mais il est reellement servi et facture par flash.
  const allowed = await proxyChat(key, { model: 'claude-opus-5.5' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('x-gateway-billed-model'), 'deepseek-flash');
  assert.equal(allowed.headers.get('x-gateway-requested-model'), 'claude-opus-5.5');
  await allowed.text();
  assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');

  const deniedFlash = await proxyChat(key, { model: 'deepseek-flash' });
  assert.equal(deniedFlash.status, 403);
});

test('max_output_tokens plafonne la demande', async () => {
  const { key } = await createClient({ name: 'Ami plafond', maxOutputTokens: 16, period: 'total' });
  const res = await proxyChat(key, { max_tokens: 1000 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.echo_max_tokens, 16);
});

test('requete JSON invalide refusee sans consommer le quota', async () => {
  const { client, key } = await createClient({ name: 'Ami json', period: 'total' });
  const res = await proxyChat(key, '{ceci nest pas du json');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'invalid_json');
  const updated = await getClient(client.id);
  assert.equal(updated.usedRequests, 0);
});

test('GET /v1/models passe sans consommer le quota', async () => {
  const { client, key } = await createClient({ name: 'Ami models', period: 'total' });
  const res = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.object, 'list');
  const updated = await getClient(client.id);
  assert.equal(updated.usedRequests, 0);
});

test('decouverte de modeles : /v1/models et /anthropic/v1/models servis localement', async () => {
  const { key } = await createClient({ name: 'Decouverte modeles', period: 'total' });

  // Format OpenAI (avec alias de modeles inclus).
  const openai = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(openai.status, 200);
  const openaiBody = await openai.json();
  assert.equal(openaiBody.object, 'list');
  const openaiIds = openaiBody.data.map((model) => model.id);
  assert.ok(openaiIds.includes('deepseek-flash'), `modeles: ${openaiIds.join(', ')}`);
  assert.ok(openaiIds.includes('claude-opus-5'), 'les alias doivent apparaitre dans la liste');
  assert.ok(openaiIds.includes('claude-opus-5.5'), 'claude-opus-5.5 doit apparaitre dans la liste');
  assert.ok(openaiIds.includes('fable-5'), 'fable-5 doit apparaitre dans la liste');
  assert.ok(openaiIds.includes('fable-5.1'), 'fable-5.1 doit apparaitre dans la liste');

  // Format Anthropic (utilise par Claude Desktop pour la decouverte).
  const anthropic = await fetch(`${base}/anthropic/v1/models`, {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  assert.equal(anthropic.status, 200);
  const anthropicBody = await anthropic.json();
  assert.ok(Array.isArray(anthropicBody.data) && anthropicBody.data.length >= 1);
  assert.equal(anthropicBody.data[0].type, 'model');
  assert.ok(anthropicBody.data.some((model) => model.id === 'deepseek-flash'));

  // Sans authentification : refus propre (pas de fuite ni de 404).
  const noAuth = await fetch(`${base}/anthropic/v1/models`);
  assert.equal(noAuth.status, 401);
});

test('preflight CORS accepte', async () => {
  const res = await fetch(`${base}/v1/chat/completions`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('desactivation, regeneration et suppression d une cle', async () => {
  const { client, key } = await createClient({ name: 'Ami cycle de vie', period: 'total' });

  const disable = await api(`/admin/api/clients/${client.id}`, { method: 'PATCH', body: { enabled: false } });
  assert.equal(disable.status, 200);
  const disabled = await proxyChat(key);
  assert.equal(disabled.status, 403);
  assert.equal((await disabled.json()).error.code, 'client_disabled');

  await api(`/admin/api/clients/${client.id}`, { method: 'PATCH', body: { enabled: true } });
  const regen = await api(`/admin/api/clients/${client.id}/regenerate`, { method: 'POST' });
  assert.equal(regen.status, 200);
  const newKey = regen.data.key;
  assert.notEqual(newKey, key);

  const oldKey = await proxyChat(key);
  assert.equal(oldKey.status, 401);
  const ok = await proxyChat(newKey);
  assert.equal(ok.status, 200);
  await ok.text();

  const del = await api(`/admin/api/clients/${client.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  const deleted = await proxyChat(newKey);
  assert.equal(deleted.status, 401);
});

test('remise a zero du quota', async () => {
  const { client, key } = await createClient({ name: 'Ami reset', quotaTokens: 12, period: 'total' });
  const first = await proxyChat(key);
  assert.equal(first.status, 200);
  await first.text();
  const blocked = await proxyChat(key);
  assert.equal(blocked.status, 429);
  const reset = await api(`/admin/api/clients/${client.id}/reset`, { method: 'POST' });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.client.usedTokens, 0);
  const again = await proxyChat(key);
  assert.equal(again.status, 200);
  await again.text();
});

test('reglages : cle originale jamais exposee, champs env verrouilles, tarifs modifiables', async () => {
  const { data } = await api('/admin/api/settings');
  assert.equal(data.provider.configured, true);
  assert.equal(data.provider.source, 'env');
  assert.equal(data.provider.baseUrl, mock.url);
  assert.ok(data.provider.masked.endsWith(ORIGINAL_KEY.slice(-4)));
  assert.ok(!JSON.stringify(data).includes(ORIGINAL_KEY));

  const envEdit = await api('/admin/api/settings', {
    method: 'PUT',
    body: { providerApiKey: 'sk-autre-cle' },
  });
  assert.equal(envEdit.status, 409);
  assert.equal(envEdit.data.error.code, 'env_managed');

  const pricing = structuredClone(data.pricing);
  pricing.models['deepseek-flash'].output.offpeak = 0.7;
  const save = await api('/admin/api/settings', { method: 'PUT', body: { pricing } });
  assert.equal(save.status, 200);
  const after = await api('/admin/api/settings');
  assert.equal(after.data.pricing.models['deepseek-flash'].output.offpeak, 0.7);

  const badPricing = await api('/admin/api/settings', { method: 'PUT', body: { pricing: { models: {} } } });
  assert.equal(badPricing.status, 400);
});

test('vue d ensemble coherente', async () => {
  const { status, data } = await api('/admin/api/overview');
  assert.equal(status, 200);
  assert.ok(data.counts.clientsTotal >= 1);
  assert.ok(data.totals.requests >= 1);
  assert.ok(data.totals.tokens >= 12);
  assert.equal(data.series.length, 30);
  assert.match(data.series.at(-1).day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.provider.configured, true);
});

test('journaux pagines et filtrables', async () => {
  const { data } = await api('/admin/api/logs?limit=5');
  assert.ok(data.rows.length >= 1);
  assert.ok(data.total >= data.rows.length);
  assert.ok(data.rows.every((row) => typeof row.clientName === 'string'));
});

test('alias de modele : claude-opus-5 est servi par deepseek-flash', async () => {
  const { client, key } = await createClient({ name: 'Alias opus 5', period: 'total' });
  const res = await proxyChat(key, { model: 'claude-opus-5' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gateway-requested-model'), 'claude-opus-5');
  assert.equal(res.headers.get('x-gateway-billed-model'), 'deepseek-flash');
  const body = await res.json();
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');

  // fable-5, fable-5.1 et claude-opus-5.5 sont aussi des alias par defaut, servis par flash.
  for (const alias of ['fable-5', 'fable-5.1', 'claude-opus-5.5']) {
    const aliasRes = await proxyChat(key, { model: alias });
    assert.equal(aliasRes.status, 200, alias);
    assert.equal(aliasRes.headers.get('x-gateway-requested-model'), alias);
    assert.equal(aliasRes.headers.get('x-gateway-billed-model'), 'deepseek-flash');
    await aliasRes.text();
    assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');
  }

  // Journal de facturation reelle : modele demande + modele facture + cout.
  const { data: logs } = await api(`/admin/api/clients/${client.id}/logs?limit=20`);
  const aliasRows = logs.rows.filter((row) => row.requestedModel);
  assert.ok(
    aliasRows.some((row) => row.requestedModel === 'claude-opus-5' && row.model === 'deepseek-flash'),
    'journal : claude-opus-5 doit etre trace comme demande, deepseek-flash comme facture',
  );
  assert.ok(
    aliasRows.some((row) => row.requestedModel === 'fable-5' && row.model === 'deepseek-flash'),
    'journal : fable-5 doit etre trace',
  );
  assert.ok(
    aliasRows.some((row) => row.requestedModel === 'fable-5.1' && row.model === 'deepseek-flash'),
    'journal : fable-5.1 doit etre trace',
  );
  assert.ok(aliasRows.every((row) => row.costUsd > 0), 'cout reel enregistre pour les alias');
});

test('alias de modele : variante datee et format Anthropic (Claude Code)', async () => {
  const { key } = await createClient({ name: 'Alias opus 5 date', period: 'total' });
  const dated = await proxyChat(key, { model: 'claude-opus-5-20260101' });
  assert.equal(dated.status, 200);
  await dated.text();
  assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({
      model: 'claude-opus-5',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hey' }],
    }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.model, 'deepseek-flash');
  assert.equal(mock.seen.at(-1).url, '/anthropic/v1/messages');
  assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');
});

test('alias de modele : la liste d autorisation est comparee au modele facture', async () => {
  const { key } = await createClient({
    name: 'Alias allowlist facture',
    allowedModels: ['deepseek-flash'],
    period: 'total',
  });
  const res = await proxyChat(key, { model: 'claude-opus-5' });
  assert.equal(res.status, 200);
  await res.text();
});

test('alias de modele personnalises via les reglages, puis retour aux defauts', async () => {
  try {
    const save = await api('/admin/api/settings', {
      method: 'PUT',
      body: { modelAliases: { 'mon-modele': 'deepseek-flash' } },
    });
    assert.equal(save.status, 200);
    const settingsView = await api('/admin/api/settings');
    assert.equal(settingsView.data.modelAliases['mon-modele'], 'deepseek-flash');

    const { key } = await createClient({ name: 'Alias perso', period: 'total' });
    const res = await proxyChat(key, { model: 'mon-modele' });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');

    // La table personnalisee remplace les defauts, MAIS la facturation forcee reste flash.
    const notMapped = await proxyChat(key, { model: 'claude-opus-5' });
    assert.equal(notMapped.status, 200);
    assert.equal(notMapped.headers.get('x-gateway-billed-model'), 'deepseek-flash');
    await notMapped.text();
    assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');
  } finally {
    const restore = await api('/admin/api/settings', { method: 'PUT', body: { modelAliases: null } });
    assert.equal(restore.status, 200);
    const defaults = await api('/admin/api/settings');
    assert.equal(defaults.data.modelAliases['claude-opus-5*'], 'deepseek-flash');
  }
});

test('changement de mot de passe admin', async () => {
  const wrong = await api('/admin/api/settings/password', {
    method: 'POST',
    body: { currentPassword: 'pas-le-bon', newPassword: 'nouveau-mot-de-passe-42' },
  });
  assert.equal(wrong.status, 401);

  const changed = await api('/admin/api/settings/password', {
    method: 'POST',
    body: { currentPassword: ADMIN_PASSWORD, newPassword: 'nouveau-mot-de-passe-42' },
  });
  assert.equal(changed.status, 200);
  cookie = changed.res.headers.getSetCookie()[0].split(';')[0];

  const session = await api('/admin/api/session');
  assert.equal(session.status, 200);
  assert.equal(session.data.authenticated, true);

  const oldLogin = await login(ADMIN_PASSWORD);
  assert.equal(oldLogin.status, 401);
  const newLogin = await login('nouveau-mot-de-passe-42');
  assert.equal(newLogin.status, 200);
});

test('Claude Code : /v1/messages est redirige vers /anthropic et l ancien nom de modele est converti', async () => {
  const { client, key } = await createClient({ name: 'Claude Code JSON', period: 'total' });
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'deepseek-v4-flash', max_tokens: 64, messages: [{ role: 'user', content: 'hey' }] }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.type, 'message');

  const seen = mock.seen.at(-1);
  assert.equal(seen.url, '/anthropic/v1/messages');
  assert.equal(seen.auth, `Bearer ${ORIGINAL_KEY}`);
  assert.equal(seen.body.model, 'deepseek-flash');

  const updated = await getClient(client.id);
  assert.equal(updated.usedTokens, 30); // 20 tokens d'entree + 10 de sortie
  const { data: logs } = await api(`/admin/api/clients/${client.id}/logs`);
  assert.equal(logs.rows[0].status, 200);
  assert.equal(logs.rows[0].model, 'deepseek-flash');
  assert.equal(logs.rows[0].totalTokens, 30);
});

test('Claude Code : streaming SSE Anthropic comptabilise', async () => {
  const { client, key } = await createClient({ name: 'Claude Code stream', period: 'total' });
  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ model: 'deepseek-flash', stream: true, max_tokens: 64, messages: [{ role: 'user', content: 'hey' }] }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /message_stop/);
  assert.match(text, /Bonjour/);
  const updated = await getClient(client.id);
  assert.equal(updated.usedTokens, 30);
});

test('ancien nom de modele converti aussi via l API OpenAI', async () => {
  const { key } = await createClient({ name: 'Alias OpenAI', period: 'total' });
  const res = await proxyChat(key, { model: 'deepseek-v4-flash' });
  assert.equal(res.status, 200);
  await res.text();
  assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');
});

test('v4-pro expose mais toujours servi et facture par deepseek-flash', async () => {
  const { key } = await createClient({
    name: 'Alias allowlist',
    allowedModels: ['deepseek-flash'],
    period: 'total',
  });
  for (const model of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
    const res = await proxyChat(key, { model });
    assert.equal(res.status, 200, model);
    assert.equal(res.headers.get('x-gateway-billed-model'), 'deepseek-flash');
    assert.equal(res.headers.get('x-gateway-requested-model'), model);
    await res.text();
    assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash');
  }
});

test('tous les modeles exposes (claude, fable, v4-pro, inconnu) partent sur flash', async () => {
  const { client, key } = await createClient({ name: 'Flash partout', period: 'total' });
  const requestedModels = [
    'deepseek-v4-pro',
    'claude-opus-5',
    'claude-opus-5.5',
    'fable-5.1',
    'modele-inconnu',
  ];
  for (const requested of requestedModels) {
    const res = await proxyChat(key, { model: requested });
    assert.equal(res.status, 200, requested);
    assert.equal(res.headers.get('x-gateway-billed-model'), 'deepseek-flash');
    assert.equal(res.headers.get('x-gateway-requested-model'), requested);
    await res.text();
    assert.equal(mock.seen.at(-1).body.model, 'deepseek-flash', requested);
  }

  const { data: logs } = await api(`/admin/api/clients/${client.id}/logs?limit=10`);
  assert.ok(logs.rows.some((row) => row.requestedModel === 'deepseek-v4-pro'));
  assert.ok(logs.rows.every((row) => row.model === 'deepseek-flash'));
});

test('chemin avec slashs multiples normalise', async () => {
  const { key } = await createClient({ name: 'Slashes', period: 'total' });
  const res = await fetch(`${base}//v1/models`, { headers: { authorization: `Bearer ${key}` } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).object, 'list');
});

test('corps de requete trop volumineux -> 413 explicite (limite configurable)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gateway-big-'));
  const local = await startGateway({
    dataDir: dir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: ORIGINAL_KEY,
    providerBaseUrl: mock.url,
    adminPassword: 'mot-de-passe-test-123',
    maxBodyBytes: 4096,
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    const loginRes = await fetch(`${local.url}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
      body: JSON.stringify({ password: 'mot-de-passe-test-123' }),
    });
    const localCookie = loginRes.headers.getSetCookie()[0].split(';')[0];
    const created = await fetch(`${local.url}/admin/api/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin', cookie: localCookie },
      body: JSON.stringify({ name: 'Corps volumineux', period: 'total' }),
    });
    const { key } = await created.json();

    const res = await fetch(`${local.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: 'x'.repeat(6000) }],
      }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error.code, 'payload_too_large');
    assert.match(body.error.message, /MAX_BODY_BYTES/);
    assert.match(body.error.message, /limite 4 Ko/);
  } finally {
    await local.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cle fournisseur absente -> 503 explicite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsk-gateway-nokey-'));
  const local = await startGateway({
    dataDir: dir,
    host: '127.0.0.1',
    port: 0,
    httpsPort: 0,
    tlsCertFile: '',
    tlsKeyFile: '',
    ipRateLimitPerMin: 0,
    providerApiKey: '',
    providerBaseUrl: mock.url,
    adminPassword: 'mot-de-passe-test-123',
    logLevel: 'error',
    logger: silentLogger,
  });
  try {
    const loginRes = await fetch(`${local.url}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'dsk-admin' },
      body: JSON.stringify({ password: 'mot-de-passe-test-123' }),
    });
    const localCookie = loginRes.headers.getSetCookie()[0].split(';')[0];
    const created = await fetch(`${local.url}/admin/api/clients`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'dsk-admin',
        cookie: localCookie,
      },
      body: JSON.stringify({ name: 'Test sans cle', period: 'total' }),
    });
    const createdData = await created.json();
    const res = await fetch(`${local.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${createdData.key}` },
      body: JSON.stringify({ model: 'deepseek-flash', messages: [{ role: 'user', content: 'x' }] }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error.code, 'provider_not_configured');
  } finally {
    await local.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

