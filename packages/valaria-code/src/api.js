/**
 * Client API VALARIA : chat streaming, modèles, compte, quota.
 * Aucune clé API n'est requise : le jeton d'appareil suffit.
 */
import { normalizeBaseUrl } from './config.js';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'api_error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ValariaClient {
  constructor({ url, token, model = 'gpt-5', fetchImpl = fetch } = {}) {
    this.baseUrl = normalizeBaseUrl(url);
    this.token = token;
    this.model = model;
    this.fetch = fetchImpl;
  }

  headers(extra = {}) {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
      ...extra,
    };
  }

  async errorFrom(response) {
    const text = await response.text().catch(() => '');
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    const message = data?.error?.message || `Erreur HTTP ${response.status}`;
    return new ApiError(message, { status: response.status, code: data?.error?.code || `http_${response.status}` });
  }

  async me() {
    const response = await this.fetch(`${this.baseUrl}/portal/api/me`, { headers: this.headers() });
    if (!response.ok) throw await this.errorFrom(response);
    return response.json();
  }

  async models() {
    const response = await this.fetch(`${this.baseUrl}/v1/models`, { headers: this.headers() });
    if (!response.ok) throw await this.errorFrom(response);
    const data = await response.json();
    return (data.data || []).map((model) => model.id).filter(Boolean);
  }

  /**
   * Chat non streamé. Retourne { content, usage, model }.
   */
  async chat(messages, { model = this.model, temperature = 0.3, maxTokens = 4096 } = {}) {
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: false }),
    });
    if (!response.ok) throw await this.errorFrom(response);
    const data = await response.json();
    return {
      content: data?.choices?.[0]?.message?.content || '',
      usage: data?.usage || null,
      model: data?.model || model,
    };
  }

  /**
   * Chat streamé SSE. onDelta reçoit chaque morceau de texte.
   */
  async stream(messages, { model = this.model, temperature = 0.3, maxTokens = 4096, onDelta = null, signal = null } = {}) {
    const response = await this.fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true }),
      signal,
    });
    if (!response.ok) throw await this.errorFrom(response);
    if (!response.body) throw new ApiError('Réponse streaming vide.', { status: 502 });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usage = null;
    let resolvedModel = model;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let event;
            try { event = JSON.parse(payload); } catch { continue; }
            if (event.model) resolvedModel = event.model;
            if (event.usage) usage = event.usage;
            const delta = event?.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              if (onDelta) onDelta(delta);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    return { content, usage, model: resolvedModel };
  }
}

export function createClient(options) {
  return new ValariaClient(options);
}
