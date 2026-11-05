// Tests du niveau de log « silent » (zéro sortie normale).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, printStartupBanner } from '../src/app.js';

test('logger silent : aucune sortie, banner supprime', () => {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const output = [];
  console.log = (...args) => output.push(['log', ...args]);
  console.warn = (...args) => output.push(['warn', ...args]);
  console.error = (...args) => output.push(['error', ...args]);
  try {
    const logger = createLogger('silent', 'json');
    assert.equal(logger.silent, true);
    assert.equal(logger.level, 'silent');
    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    printStartupBanner({ log: logger, config: {} }, () => output.push(['banner']));

    const none = createLogger('none');
    assert.equal(none.silent, true);
    none.error('rien');

    const normal = createLogger('error');
    assert.equal(normal.silent, false);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.deepEqual(output, []);
});
