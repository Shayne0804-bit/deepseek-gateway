import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCORD_CATEGORY_NAME, DISCORD_CHANNEL_TEMPLATES, channelNames, templateByKey } from '../src/discord/channels.js';
import { channelDocs } from '../src/discord/content.js';
import { startDiscordBot } from '../src/discord/bot.js';

test('templates Discord VALARIA : catégorie, salons et sujets', () => {
  assert.match(DISCORD_CATEGORY_NAME, /𝐕𝐀𝐋𝐀𝐑𝐈𝐀 𝐆𝐀𝐓𝐄𝐖𝐀𝐘/);
  assert.ok(/[｜💠]/.test(DISCORD_CATEGORY_NAME), 'la catégorie doit utiliser des caractères spéciaux');
  assert.ok(DISCORD_CHANNEL_TEMPLATES.length >= 7);
  const names = channelNames();
  assert.equal(new Set(names).size, names.length, 'les noms de salons doivent être uniques');
  const legacyNames = DISCORD_CHANNEL_TEMPLATES.map((template) => template.legacyName);
  assert.equal(new Set(legacyNames).size, legacyNames.length);
  for (const template of DISCORD_CHANNEL_TEMPLATES) {
    assert.ok(template.name.length > template.legacyName.length, `nom stylé attendu pour ${template.legacyName}`);
    assert.match(template.name, /^｜.+｜/);
    assert.ok(template.topic.length > 10);
    assert.equal(typeof template.readOnly, 'boolean');
  }
  assert.equal(templateByKey('status').readOnly, true);
  assert.equal(templateByKey('api').readOnly, false);
  assert.equal(templateByKey('api').name, '｜🔌｜𝐚𝐩𝐢');
  assert.equal(templateByKey('welcome').name, '｜💠｜𝐛𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞');
  assert.equal(templateByKey('inconnu'), null);
});

test('documentation Discord : contenu complet et limites embed', () => {
  const site = 'https://api.valariamenu.test';
  for (const key of ['welcome', 'announcements', 'status', 'general', 'support', 'api', 'valaria-code', 'reports']) {
    const docs = channelDocs(key, site);
    assert.ok(docs.length >= 1, `documentation absente pour ${key}`);
    for (const doc of docs) {
      assert.ok(doc.title && doc.description);
      assert.ok(doc.description.length <= 4096, `description trop longue pour ${key}`);
    }
    assert.ok(docs.some((doc) => doc.description.includes(site)), `le site doit être lié dans ${key}`);
  }
  assert.ok(channelDocs('api', site).length >= 4, 'le salon API doit contenir la documentation complète');
  assert.ok(channelDocs('valaria-code', site).length >= 4, 'le salon CLI doit contenir la documentation complète');
});

test('bot Discord : désactivé sans token ou guilde', async () => {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  assert.equal(await startDiscordBot({ env: {}, logger }), null);
  assert.equal(await startDiscordBot({ env: { DISCORD_TOKEN: 'test' }, logger }), null);
  assert.equal(await startDiscordBot({ env: { DISCORD_GUILD_ID: '123' }, logger }), null);
});

