import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISCORD_CATEGORY_NAME, DISCORD_CHANNEL_TEMPLATES, channelNames, templateByKey } from '../src/discord/channels.js';
import { startDiscordBot } from '../src/discord/bot.js';

test('templates Discord VALARIA : catégorie, salons et sujets', () => {
  assert.equal(DISCORD_CATEGORY_NAME, 'VALARIA GATEWAY');
  assert.ok(DISCORD_CHANNEL_TEMPLATES.length >= 6);
  const names = channelNames();
  assert.equal(new Set(names).size, names.length, 'les noms de salons doivent être uniques');
  for (const template of DISCORD_CHANNEL_TEMPLATES) {
    assert.match(template.name, /^[a-z0-9-]+$/);
    assert.ok(template.topic.length > 10);
    assert.equal(typeof template.readOnly, 'boolean');
  }
  assert.equal(templateByKey('status').readOnly, true);
  assert.equal(templateByKey('api').readOnly, false);
  assert.equal(templateByKey('inconnu'), null);
});

test('bot Discord : désactivé sans token ou guilde', async () => {
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  assert.equal(await startDiscordBot({ env: {}, logger }), null);
  assert.equal(await startDiscordBot({ env: { DISCORD_TOKEN: 'test' }, logger }), null);
  assert.equal(await startDiscordBot({ env: { DISCORD_GUILD_ID: '123' }, logger }), null);
});

