import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { APP_VERSION, loadConfig } from './config.js';
import {
  cleanupAdminSessions,
  cleanupPortalEmailCodes,
  cleanupPortalSessions,
  closeDb,
  deleteUsageLogsBefore,
  getSetting,
  openDb,
  setSetting,
} from './db.js';
import { bootstrapAdmin, migrateProviderSecret, resolveProviderConfig } from './settings.js';
import { createAdminApi } from './admin-api.js';
import { createPortalApi } from './portal-api.js';
import { createMailer } from './mailer.js';
import { createProxyHandler, isProxyPath } from './proxy.js';
import { DEFAULT_PRICING } from './pricing.js';
import { IpRateLimiter } from './limits.js';
import {
  applySecurityHeaders,
  clientIp,
  corsHeaders,
  isHttpsRequest,
  sendJson,
} from './http-utils.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SILENT_LEVELS = new Set(['silent', 'none', 'off', '0']);

export function createLogger(level = 'info', format = 'text') {
  const silent = SILENT_LEVELS.has(String(level).trim().toLowerCase());
  const threshold = silent ? Number.POSITIVE_INFINITY : (LEVELS[level] ?? LEVELS.info);
  const emit = (name, message) => {
    if (silent || (LEVELS[name] ?? 20) < threshold) return;
    if (format === 'json') {
      const line = JSON.stringify({ ts: new Date().toISOString(), level: name, msg: String(message) });
      if (name === 'error' || name === 'warn') console.error(line);
      else console.log(line);
      return;
    }
    const line = `${new Date().toISOString()} [${name.toUpperCase()}] ${message}`;
    if (name === 'error' || name === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    level: silent ? 'silent' : level,
    format,
    silent,
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
  };
}

const ASSETS = {
  // Site public
  '/': { file: 'landing.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'landing.html', type: 'text/html; charset=utf-8' },
  '/assets/landing.js': { file: 'landing.js', type: 'text/javascript; charset=utf-8' },
  // Console d'administration
  '/admin': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/admin/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/assets/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  // Espace utilisateur
  '/portal': { file: 'portal.html', type: 'text/html; charset=utf-8' },
  '/portal/': { file: 'portal.html', type: 'text/html; charset=utf-8' },
  '/assets/portal.js': { file: 'portal.js', type: 'text/javascript; charset=utf-8' },
  // Communs
  '/assets/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/favicon.svg': { file: 'favicon.svg', type: 'image/svg+xml' },
};

// Compression des assets texte (sans dependance) : cache par fichier.
const gzipCache = new Map();

function gzipAsset(asset, buffer) {
  const cached = gzipCache.get(asset.file);
  if (cached && cached.rawSize === buffer.length) return cached.gz;
  const gz = zlib.gzipSync(buffer);
  gzipCache.set(asset.file, { rawSize: buffer.length, gz });
  return gz;
}

function serveAsset(req, res, config, asset) {
  fs.readFile(path.join(config.publicDir, asset.file), (err, buffer) => {
    if (err) {
      sendJson(res, 404, { error: { message: 'Fichier introuvable.', type: 'invalid_request_error', code: 'not_found' } });
      return;
    }
    const isHtml = asset.type.startsWith('text/html');
    const headers = {
      'content-type': asset.type,
      'cache-control': isHtml ? 'no-cache' : 'public, max-age=300',
      vary: 'accept-encoding',
    };
    let payload = buffer;
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      payload = gzipAsset(asset, buffer);
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = payload.length;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(payload);
  });
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('error', onError);
      reject(err);
    };
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

/**
 * Construit les options TLS du serveur HTTPS a partir de la configuration.
 * Retourne null si aucun certificat n'est configure (HTTPS desactive).
 */
export function buildTlsOptions(config) {
  const hasPfx = Boolean(config.tlsPfxFile);
  const hasPem = Boolean(config.tlsCertFile) && Boolean(config.tlsKeyFile);
  if (!hasPfx && !hasPem) return null;

  const read = (file, label) => {
    if (!fs.existsSync(file)) {
      throw new Error(`${label} introuvable : ${file}`);
    }
    return fs.readFileSync(file);
  };

  if (hasPfx) {
    return {
      pfx: read(config.tlsPfxFile, 'TLS_PFX_FILE'),
      passphrase: config.tlsPfxPassphrase || undefined,
    };
  }
  return {
    cert: read(config.tlsCertFile, 'TLS_CERT_FILE'),
    key: read(config.tlsKeyFile, 'TLS_KEY_FILE'),
  };
}

/**
 * Demarre la passerelle complete.
 * `overrides` : { dataDir, host, port, providerApiKey, providerBaseUrl, publicBaseUrl,
 *                 adminPassword, logLevel, logger, upstreamTimeoutMs, maxBodyBytes,
 *                 httpsPort, tlsCertFile, tlsKeyFile, tlsPfxFile, tlsPfxPassphrase }
 */
export async function startGateway(overrides = {}) {
  const config = loadConfig(overrides);
  const log = overrides.logger ?? createLogger(config.logLevel, config.logFormat);
  const db = openDb(config.dataDir);

  // Tarification par defaut si premiere utilisation.
  if (getSetting(db, 'pricing', null) == null) {
    setSetting(db, 'pricing', DEFAULT_PRICING);
  }

  // Mot de passe administrateur (premiere utilisation).
  const adminBootstrap = bootstrapAdmin(db, config);
  let generatedPasswordFile = null;
  if (adminBootstrap.generatedPassword) {
    generatedPasswordFile = path.join(config.dataDir, 'admin-password.txt');
    fs.writeFileSync(
      generatedPasswordFile,
      [
        'Mot de passe administrateur VALARIA Gateway API (genere au premier demarrage)',
        '',
        adminBootstrap.generatedPassword,
        '',
        'Changez-le dans le panneau > Reglages, puis supprimez ce fichier.',
        '',
      ].join('\n'),
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  const resolveProvider = (database, cfg) => resolveProviderConfig(database, cfg);
  migrateProviderSecret(db, config, log);
  const mailer = overrides.mailer ?? createMailer(config, log);
  const adminApi = createAdminApi({ config, db, log, mailer });
  const portalApi = createPortalApi({ config, db, log, mailer });
  const proxyHandler = createProxyHandler({ config, db, log, resolveProvider });
  const ipLimiter = new IpRateLimiter();

  /** Avertissements de configuration a afficher au demarrage (production). */
  function computeStartupWarnings(startedInfo) {
    const warnings = [];
    const loopback = ['127.0.0.1', '::1', 'localhost', ''].includes(config.host);
    const httpsOn = Boolean(startedInfo.tlsEnabled);
    if (!loopback && !httpsOn && !config.trustProxy) {
      warnings.push(
        "Interface exposee en HTTP non chiffre : placez un reverse proxy HTTPS (TRUST_PROXY=1) ou activez le HTTPS natif (TLS_*).",
      );
    }
    if (!loopback && config.trustProxy && !httpsOn) {
      warnings.push(
        'TRUST_PROXY=1 : verifiez que le reverse proxy termine bien le TLS et transmet X-Forwarded-Proto.',
      );
    }
    if (startedInfo.adminBootstrap?.generatedPassword) {
      warnings.push('Mot de passe admin genere au premier demarrage : changez-le dans Reglages.');
    }
    if (config.maxBodyBytes === Number.POSITIVE_INFINITY) {
      warnings.push('MAX_BODY_BYTES=0 (illimite) : risque memoire en production.');
    }
    if (config.mailTransport === 'console') {
      warnings.push('Connexion email en mode console : les codes s’affichent dans les logs. Configurez MAIL_TRANSPORT (resend/smtp) en production.');
    }
    if (config.emailLoginEnabled && !config.publicBaseUrl) {
      warnings.push('Connexion email active mais PUBLIC_BASE_URL vide : renseignez l’URL publique.');
    }
    return warnings;
  }

  let startupWarnings = [];

  async function route(req, res) {
    const requestId = crypto.randomBytes(6).toString('hex');
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    const httpsRequest = isHttpsRequest(req, config.trustProxy);
    applySecurityHeaders(res, { https: httpsRequest });
    const host = req.headers.host ?? `${config.host}:${config.port}`;
    let url;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      sendJson(res, 400, { error: { message: 'URL invalide.', type: 'invalid_request_error', code: 'bad_request' } });
      return;
    }
    const pathname = url.pathname.replace(/\/{2,}/g, '/');

    const isApi = isProxyPath(pathname);
    const isAdminApi = pathname.startsWith('/admin/api');
    const isPortalApi = pathname.startsWith('/portal/api');
    if (isApi || isAdminApi || isPortalApi) {
      const limited = ipLimiter.hit(clientIp(req, config.trustProxy), config.ipRateLimitPerMin);
      if (!limited.ok) {
        log.warn(`[${requestId}] Limite IP atteinte (${clientIp(req, config.trustProxy)})`);
        sendJson(
          res,
          429,
          {
            error: {
              message: `Trop de requetes. Reessayez dans ${limited.retryAfter} s.`,
              type: 'rate_limit_error',
              code: 'ip_rate_limit',
              param: null,
            },
          },
          { ...(isApi ? corsHeaders() : {}), 'retry-after': String(limited.retryAfter), 'cache-control': 'no-store' },
        );
        return;
      }
    }

    if (pathname === '/healthz' || pathname === '/readyz') {
      const provider = resolveProvider(db, config);
      sendJson(res, 200, {
        ok: true,
        name: 'valaria-gateway',
        version: APP_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        providerConfigured: Boolean(provider.apiKey),
        warnings: startupWarnings,
      });
      return;
    }

    if (pathname === '/robots.txt') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      });
      res.end('User-agent: *\nDisallow: /\n');
      return;
    }

    if (isAdminApi) {
      await adminApi.handle(req, res, url, pathname);
      return;
    }

    if (isPortalApi) {
      await portalApi.handle(req, res, url, pathname);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && ASSETS[pathname]) {
      serveAsset(req, res, config, ASSETS[pathname]);
      return;
    }

    if (pathname.startsWith('/admin') || pathname.startsWith('/portal')) {
      sendJson(res, 404, { error: { message: 'Page introuvable.', type: 'invalid_request_error', code: 'not_found' } });
      return;
    }

    if (isApi) {
      await proxyHandler(req, res, url);
      return;
    }

    sendJson(res, 404, {
      error: {
        message: 'Route inconnue. L API est disponible sous /v1/... ; le site sur / et la console sur /admin.',
        type: 'invalid_request_error',
        code: 'not_found',
      },
    });
  }

  const handleRequest = (req, res) => {
    route(req, res).catch((err) => {
      log.error(`[${req.requestId ?? '-'}] Erreur non geree : ${err?.stack ?? err}`);
      if (!res.headersSent) {
        sendJson(res, 500, {
          error: {
            message: `Erreur interne. Reessayez. (ref ${req.requestId ?? '-'})`,
            type: 'api_error',
            code: 'internal_error',
          },
        });
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  };

  // 5 min : laisse le temps d'envoyer de gros corps (contexte long, images).
  const applyTimeouts = (srv) => {
    srv.requestTimeout = 300_000;
    srv.headersTimeout = 65_000;
  };

  const server = http.createServer(handleRequest);
  applyTimeouts(server);

  // HTTPS optionnel : requis par certains clients (Claude Desktop refuse http://).
  let tlsOptions = null;
  try {
    tlsOptions = buildTlsOptions(config);
  } catch (err) {
    closeDb(db);
    throw err;
  }

  let httpsServer = null;

  // Nettoyage periodique : sessions, fenetres de debit, retention des journaux.
  const maintenance = setInterval(() => {
    try {
      const nowIso = new Date().toISOString();
      cleanupAdminSessions(db, nowIso);
      cleanupPortalSessions(db, nowIso);
      cleanupPortalEmailCodes(db, nowIso);
      ipLimiter.prune();
      if (config.usageRetentionDays > 0) {
        const cutoff = new Date(Date.now() - config.usageRetentionDays * 86_400_000).toISOString();
        const deleted = deleteUsageLogsBefore(db, cutoff);
        if (deleted > 0) log.info(`Retention : ${deleted} ligne(s) de journal supprimee(s) (> ${config.usageRetentionDays} j).`);
      }
    } catch (err) {
      log.warn(`Maintenance : ${err.message}`);
    }
  }, 60 * 60 * 1000);
  maintenance.unref();

  let address;
  let httpsAddress = null;
  try {
    address = await listen(server, config.host, config.port);
    if (tlsOptions) {
      httpsServer = https.createServer(tlsOptions, handleRequest);
      applyTimeouts(httpsServer);
      httpsAddress = await listen(httpsServer, config.host, config.httpsPort);
    }
  } catch (err) {
    clearInterval(maintenance);
    if (httpsServer) httpsServer.close();
    server.close();
    closeDb(db);
    throw err;
  }

  const actualPort = address.port;
  const actualHttpsPort = httpsAddress ? httpsAddress.port : null;
  startupWarnings = computeStartupWarnings({ tlsEnabled: Boolean(tlsOptions), adminBootstrap });
  for (const warning of startupWarnings) log.warn(`PRODUCTION : ${warning}`);

  const close = async () => {
    clearInterval(maintenance);
    await Promise.all(
      [server, httpsServer].filter(Boolean).map(
        (srv) =>
          new Promise((resolve) => {
            srv.close(() => resolve());
            if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections();
          }),
      ),
    );
    closeDb(db);
  };

  return {
    config,
    db,
    server,
    httpsServer,
    log,
    port: actualPort,
    httpsPort: actualHttpsPort,
    tlsEnabled: Boolean(tlsOptions),
    host: config.host,
    url: `http://${config.host}:${actualPort}`,
    httpsUrl: actualHttpsPort ? `https://${config.host}:${actualHttpsPort}` : null,
    adminBootstrap,
    generatedPasswordFile,
    startupWarnings,
    close,
  };
}

/** Affiche le message de demarrage convivial (utilise par server.js). */
export function printStartupBanner(started, log = console.log) {
  if (started.log?.silent) return;
  const { config, port, host, httpsPort } = started;
  const displayHost = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;
  log('');
  log('  ============================================================');
  log('   VALARIA Gateway API - partage de cle API avec quotas');
  log('  ============================================================');
  log(`   Site public   : http://${displayHost}:${port}/`);
  log(`   Espace perso  : http://${displayHost}:${port}/portal`);
  log(`   Console admin : http://${displayHost}:${port}/admin`);
  log(`   API (ami)     : http://${displayHost}:${port}/v1`);
  if (httpsPort) {
    log(`   HTTPS         : https://${displayHost}:${httpsPort}/`);
    log(`   API HTTPS     : https://${displayHost}:${httpsPort}/v1  (Claude Desktop)`);
  } else {
    log('   HTTPS         : desactive (TLS_CERT_FILE + TLS_KEY_FILE pour l activer)');
  }
  log(`   Donnees       : ${config.dataDir}`);
  if (started.adminBootstrap.generatedPassword) {
    log('');
    log('   PREMIER DEMARRAGE - mot de passe administrateur genere :');
    log(`     ${started.adminBootstrap.generatedPassword}`);
    log(`   (ecrit aussi dans : ${started.generatedPasswordFile})`);
    log('   Pensez a le changer dans le panneau > Reglages.');
  }
  if (!config.providerApiKey) {
    log('');
    log("   ATTENTION : aucune cle DeepSeek originale detectee.");
    log('   Renseignez DEEPSEEK_API_KEY dans .env, ou collez-la dans le');
    log('   panneau > Reglages avant de creer des cles pour vos amis.');
  }
  if (started.startupWarnings?.length) {
    log('');
    log('   AVERTISSEMENTS PRODUCTION :');
    for (const warning of started.startupWarnings) log(`     - ${warning}`);
  }
  log('');
  log(`   Sante         : http://${displayHost}:${port}/healthz (et /readyz)`);
  log('   Ctrl+C pour arreter.');
  log('');
}

