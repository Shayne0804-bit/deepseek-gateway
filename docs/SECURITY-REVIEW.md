# Security Review Report

**File/Component:** VALARIA Gateway API — passerelle API + panneau d'administration
**Reviewed:** 2026-11-02
**Reviewer:** security-reviewer persona (`ecc-security-reviewer`)
**Scope:** `server.js`, `src/*`, `public/*`, configuration, Docker/Railway, dépôt Git

## Summary

| Sévérité | Avant revue | Corrigés | Acceptés / documentés |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 2 | 2 | 0 |
| Medium | 6 | 6 | 0 |
| Low | 5 | 2 | 3 |

**Risk Level : 🟢 LOW** après correctifs (contre 🟡 MEDIUM avant).

Aucun secret réel n'est présent dans le dépôt ; la clé fournisseur est désormais
chiffrée au repos ; les erreurs internes ne fuient plus ; l'exposition réseau est
protégée par rate-limit, plafond de concurrence, audit et budget global.

## Critical Issues (Fix Immediately)

Aucune.

## High Issues (Fix Before Production) — CORRIGÉES

### 1. Clé API du fournisseur stockée en clair dans SQLite
**Sévérité:** HIGH — **Statut:** ✅ CORRIGÉ (v2.0.0)
**Catégorie:** Sensitive Data Exposure (OWASP A02)
**Localisation:** `src/settings.js`, `src/secrets.js`, `data/gateway.db`

**Problème :** une clé saisie dans le panneau était écrite en clair dans la table
`settings`. Une fuite de `data/` ou d'une sauvegarde exposait la clé originale.

**Impact :** utilisation frauduleuse de la facturation DeepSeek.

**Remédiation appliquée :**
- chiffrement AES-256-GCM (`enc:v1:<iv>:<tag>:<chiffré>`) avec clé maître
  32 octets (`data/master.key` en 0600 ou `MASTER_KEY`) ;
- migration automatique des valeurs en clair au démarrage ;
- la clé n'est jamais renvoyée par l'API (masque `••••1234`) ni journalisée.

### 2. Fuite d'informations via les messages d'erreur internes
**Sévérité:** HIGH — **Statut:** ✅ CORRIGÉ
**Catégorie:** Security Misconfiguration / Sensitive Data Exposure
**Localisation:** `src/app.js`, `src/proxy.js`, `src/admin-api.js`

**Problème :** les réponses 500 renvoyaient `err.message` (chemins, détails SQLite,
configuration interne) au client.

**Remédiation appliquée :** message générique côté client (`Erreur interne… (ref
x-request-id)`), détail complet uniquement dans les logs serveur, identifiant de
requête `x-request-id` sur chaque réponse et repris dans les logs.

## Medium Issues (Fix When Possible) — CORRIGÉES

### 3. Absence de rate-limit par IP et de plafond de concurrence
**Catégorie:** Insufficient Rate Limiting (OWASP A04)
**Localisation:** `src/app.js`, `src/limits.js`, `src/proxy.js`
**Remédiation :** `IP_RATE_LIMIT_PER_MIN` (240/min par défaut) sur `/admin/api` et
`/v1` + sémaphore global `MAX_CONCURRENT_REQUESTS` (200) → réponse 503 rapide.
Les quotas par clé existaient déjà.

### 4. En-têtes de sécurité incomplets
**Catégorie:** Security Misconfiguration (OWASP A05)
**Localisation:** `src/http-utils.js`
**Remédiation :** ajout `Strict-Transport-Security` (en HTTPS),
`Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`,
`object-src 'none'`, `upgrade-insecure-requests` en HTTPS. CSP existante conservée
et vérifiée par capture de rendu (aucune erreur, styles inline seuls autorisés).

### 5. Aucune traçabilité des actions d'administration
**Catégorie:** Insufficient Logging & Monitoring (OWASP A09)
**Localisation:** `src/db.js`, `src/admin-api.js`, panneau
**Remédiation :** table `admin_audit` (horodatage, IP, action, cible, détails) +
`GET /admin/api/audit` + onglet « Journal d'audit ». Couvre connexions (y compris
échecs), clés (création/modification/suppression/régénération/reset), réglages,
changement de mot de passe.

### 6. Dépense non bornée globalement (multi-utilisateurs)
**Catégorie:** Business logic / Resource consumption
**Localisation:** `src/proxy.js`, `src/settings.js`, panneau
**Remédiation :** budget mensuel global en USD (optionnel), vérifié avant chaque
requête, exposé en 429 `global_budget_exceeded`, affiché dans le panneau et
modifiable dans Réglages.

### 7. Croissance illimitée des journaux + format de logs non exploitable
**Catégorie:** Logging / Availability
**Localisation:** `src/app.js`, `src/config.js`
**Remédiation :** `USAGE_RETENTION_DAYS` (purge horaire) et `LOG_FORMAT=json`
(logs structurés pour agrégateurs).

### 8. Mot de passe admin : politique trop faible (10 caractères)
**Catégorie:** Broken Authentication (OWASP A07)
**Localisation:** `src/admin-api.js`
**Remédiation :** minimum porté à 12 caractères à la modification ; mot de passe
initial généré de 16 caractères ; verrouillage 10 tentatives/15 min conservé ;
toutes les sessions invalidées au changement.

## Low Issues — ACCEPTÉES / DOCUMENTÉES

| # | Finding | Décision |
|---|---|---|
| 9 | Pas de MFA pour l'admin unique | Accepté : outil mono-admin, mot de passe fort + verrouillage + audit. TOTP à envisager. |
| 10 | CORS `*` sur l'API publique | Accepté by design (clients navigateur/SDK) ; l'API exige une clé dérivée, aucun CORS sur l'admin API. |
| 11 | HTTPS optionnel (avertissement au démarrage) | Accepté : HSTS si TLS, avertissements production, documentation. |
| 12 | Rate-limit en mémoire (mono-instance) | Accepté : cible de déploiement mono-instance ; Redis non requis. |
| 13 | Pas de RBAC multi-admin | Accepté : mono-admin, traçabilité par audit ; évolution possible. |

## Vérifications automatisées publiées

- **Secrets** : `git grep` sur les fichiers suivis → aucune clé réelle (`.env` et
  `data/` sont ignorés et exclus de l'image Docker) ; contrôle ajouté dans le
  workflow de commit manuel.
- **Dépendances** : aucune dépendance npm (Node + `node:sqlite` intégré) → `npm audit` sans objet.
- **Injection** : toutes les requêtes SQLite sont paramétrées (`prepare(…).run/get/all`) ;
  aucun `exec` avec entrée utilisateur.
- **XSS** : échappement systématique (`esc`) côté panneau + CSP restrictive vérifiée.
- **AuthZ** : toutes les routes admin exigent une session ; CSRF par en-tête + origine.
- **Tests** : 64 tests (`node --test test`), dont chiffrement des secrets,
  rate-limit IP, budget global, audit, export CSV, HSTS, absence de fuite de la clé.
- **Rendu** : preuves desktop/mobile dans `docs/theme/` + checker frontend-design.

## Security Checklist

- [x] Aucun secret codé en dur / commité
- [x] Toutes les entrées validées (types, bornes, tailles)
- [x] Requêtes SQL paramétrées
- [x] Échappement XSS + CSP
- [x] Protection CSRF
- [x] Authentification requise sur l'admin
- [x] Autorisation vérifiée par session
- [x] Rate limiting (par clé, par IP, concurrence globale)
- [x] HTTPS supporté + HSTS + avertissement si HTTP exposé
- [x] En-têtes de sécurité
- [x] Dépendances : aucune (surface réduite)
- [x] Secrets chiffrés au repos
- [x] Logs sans secret + JSON option
- [x] Messages d'erreur sûrs
- [x] Audit des actions admin
- [x] Budget global + quotas

## Recommendations

1. Ajouter TOTP (2FA) au panneau si l'exposition publique devient permanente.
2. Centraliser les logs (`LOG_FORMAT=json`) et alerter sur pics 401/403/429 et budget 80 %.
3. Automatiser la sauvegarde chiffrée de `data/` (inclure `master.key`/`MASTER_KEY`).
4. Envisager un plafond de débit par clé activé par défaut à la création.
5. Mettre en place Dependabot/Renovate sur les images Docker de base (Node).

---

> Security review performed by DSH security-reviewer persona (`ecc-security-reviewer`).
> Voir [docs/SECURITY.md](./SECURITY.md) pour la politique et l'exploitation.

