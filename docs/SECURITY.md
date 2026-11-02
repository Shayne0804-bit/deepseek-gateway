# Sécurité — DeepSeek Gateway

Ce document décrit le modèle de menace, les mesures de sécurité intégrées et les
procédures d'exploitation pour un déploiement en production.

## Modèle de menace

| Actif | Menace principale | Mesure |
|---|---|---|
| Clé API DeepSeek originale | Vol, utilisation abusive | Jamais exposée aux clients ; chiffrée au repos ; accès panel uniquement |
| Clés dérivées (`sk-dsk-…`) | Fuite, partage non contrôlé | Hachées (SHA-256), quota par clé, révocation immédiate |
| Base SQLite (`data/`) | Lecture disque, backup fuité | Dossier restreint, secret chiffré, backups chiffrés recommandés |
| Panneau d'administration | Prise de contrôle | Mot de passe scrypt, sessions HttpOnly/SameSite, verrouillage login, CSRF |
| Passerelle API | Surcharge, brute-force | Rate-limit IP, plafond de concurrence, quotas par clé + budget global |
| Journaux | Fuite d'information | Métadonnées seulement (jamais les messages), pas de secret, rétention configurable |

**Hors périmètre** : sécurité physique, sécurité du fournisseur DeepSeek, MFA
(non implémenté — voir « Risques acceptés »).

## Mesures en place

### Secrets
- La clé fournisseur saisie dans le panneau est chiffrée en base avec
  **AES-256-GCM** ; la clé maître est dans `data/master.key` (0600) ou via
  `MASTER_KEY` (recommandé pour un volume éphémère/Railway).
- La clé de variable d'environnement (`DEEPSEEK_API_KEY`) n'est jamais écrite en base.
- Les clés dérivées ne sont montrées qu'une fois ; seule l'empreinte et le hachage sont conservés.
- Aucune clé/secret n'est écrit dans les logs.

### Authentification & sessions
- Mot de passe admin haché **scrypt** (sel aléatoire), minimum 12 caractères à
  la modification, mot de passe initial aléatoire de 16 caractères.
- Sessions : jeton 256 bits haché en base, cookie `HttpOnly`, `SameSite=Strict`,
  `Secure` en HTTPS, expiration configurable (12 h par défaut).
- Verrouillage : 10 tentatives/15 min par IP ; échecs journalisés (audit).
- Changement de mot de passe : toutes les sessions sont invalidées.

### Accès & entrées
- Toutes les routes admin exigent une session ; mutations protégées par en-tête
  personnalisé + contrôle d'origine (CSRF).
- Toute entrée JSON est validée (types, bornes, tailles) ; limite de corps configurable.
- Requêtes SQLite exclusivement paramétrées ; aucun SQL dynamique concaténé.
- Sorties du panneau échappées (`esc`) ; CSP restrictive, `object-src 'none'`,
  `frame-ancestors 'none'`, XFO/nosniff/referrer-policy.
- Les erreurs internes ne sont plus renvoyées au client (message générique + `x-request-id`).

### Disponibilité & abus
- Quotas par clé (tokens, requêtes, coût, débit, concurrence, expiration, modèles).
- **Budget global mensuel** (USD) optionnel, tous clients confondus.
- **Rate-limit IP** sur `/admin/api` et `/v1` (240 req/min par défaut).
- **Plafond global de requêtes simultanées** (200 par défaut) → 503 rapide.
- Corps de requête limité (32 Mo par défaut) et délais d'attente amont bornés.
- Rétention des journaux configurable (`USAGE_RETENTION_DAYS`).

### Observabilité
- En-tête `x-request-id` sur chaque réponse, repris dans les logs.
- `GET /healthz` et `GET /readyz` (sans authentification, sans donnée sensible).
- `LOG_FORMAT=json` pour les agrégateurs (Railway/Docker/Loki…).
- **Journal d'audit** des actions d'administration (connexion, clés, réglages, mot de passe), consultable dans le panneau.
- Export CSV des journaux d'usage pour la comptabilité.

## Checklist de mise en production

- [ ] HTTPS obligatoire (reverse proxy TLS ou TLS natif) ; `TRUST_PROXY=1` derrière un proxy.
- [ ] `ADMIN_PASSWORD` fort uniquement au premier démarrage, puis rotation via le panneau.
- [ ] `DEEPSEEK_API_KEY` en variable d'environnement (pas dans `.env` commité, pas dans le panneau si possible).
- [ ] `MASTER_KEY` fixée si le volume n'est pas persistant ; sauvegardée dans un coffre.
- [ ] `LOG_FORMAT=json`, niveau `info`, collecte centralisée.
- [ ] Budget global mensuel + quotas par clé + `IP_RATE_LIMIT_PER_MIN` adaptés.
- [ ] `PUBLIC_BASE_URL` correct (HTTPS).
- [ ] `TRUST_PROXY=1` et en-têtes `X-Forwarded-Proto` fournis par le proxy.
- [ ] Volume `data/` persistant + sauvegardes régulières (chiffrées).
- [ ] Surveillance de `/healthz`, des 401/403/429 et du solde DeepSeek.
- [ ] Rotation des clés dérivées ; révocation des accès inutilisés.
- [ ] Mise à jour Node.js (Node 24 LTS+) et des dépendances système.

## Sauvegarde et restauration

- Arrêter le service, copier tout `data/` (`gateway.db`, `master.key`) — ou
  `sqlite3 data/gateway.db ".backup data/backup.db"` à chaud.
- **Sans `master.key`**, la clé fournisseur chiffrée est irrécupérable : conservez-le
  avec la sauvegarde, dans un emplacement chiffré et à accès restreint.
- Restauration : redémarrer avec le même `MASTER_KEY` / `master.key`.

## Incidents

1. Révoquer les clés dérivées compromises (panneau → Nouvelle clé / Supprimer).
2. Si la clé originale a pu fuiter : la remplacer chez DeepSeek, puis mettre à jour
   `DEEPSEEK_API_KEY` (ou le panneau) et redémarrer.
3. Si `data/` a fuité : considérer la clé fournisseur, le mot de passe admin et
   toutes les clés dérivées comme compromis ; rotation complète.
4. Consulter le journal d'audit et les journaux d'usage pour évaluer l'exploitation.
5. Consigner l'incident et corriger la cause avant réactivation.

## Risques acceptés (documentés)

- **MFA absente** : outil mono-administrateur, mot de passe fort + verrouillage +
  audit ; TOTP est une évolution possible.
- **CORS `*` sur l'API** : by design pour les clients navigateur/SDK ; l'authentification
  reste obligatoire (clé dérivée) et l'API admin n'expose pas de CORS.
- **HTTPS optionnel** : avertissement au démarrage si HTTP est exposé sans TLS ;
  HSTS émis lorsque TLS est détecté.
- **Une seule instance** : rate-limits en mémoire (pas de Redis) ; le déploiement
  cible est mono-instance.
- **Mono-admin** : pas de RBAC ; chaque action est auditée.
