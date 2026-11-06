// Tests des alias de modeles : capacite texte/code uniquement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODEL_ALIASES,
  isTextCompatibleAlias,
  normalizeModelAliases,
} from '../src/model-aliases.js';

test('tous les alias par defaut visent le modele texte economique', () => {
  for (const [alias, target] of Object.entries(DEFAULT_MODEL_ALIASES)) {
    assert.equal(target, 'deepseek-flash', alias);
    assert.equal(isTextCompatibleAlias(alias), true, alias);
    // Aucun alias ne doit suggerer une generation d'image/audio/video.
    assert.doesNotMatch(alias, /(dall|image|imagen|flux|midjourney|sora|veo|audio|video|whisper|tts|gpt-4o|gpt-4\.1)/i, alias);
  }
});

test('les alias Codex/OpenAI texte sont acceptes', () => {
  const aliases = normalizeModelAliases({
    'gpt-5-codex': 'deepseek-flash',
    'gpt-5': 'deepseek-flash',
    'codex-mini-latest': 'deepseek-flash',
  });
  assert.deepEqual(Object.keys(aliases), ['gpt-5-codex', 'gpt-5', 'codex-mini-latest']);
});

test('un alias de modele image/audio/video est refuse', () => {
  for (const alias of ['dall-e-3', 'gpt-image-1', 'sora', 'veo-3', 'whisper-1']) {
    assert.equal(isTextCompatibleAlias(alias), false, alias);
    assert.throws(() => normalizeModelAliases({ [alias]: 'deepseek-flash' }), /texte\/code/, alias);
  }
});
