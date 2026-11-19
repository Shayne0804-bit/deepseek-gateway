# Audit de sécurité — VALARIA Gateway (site, portail, admin, API)

**Date :** 2026-11-19 · **Version auditée :** 3.13.2 (`66e48a9`)
**Périmètre :** `server.js`, `src/**`, `public/**`, Docker/Railway, en-têtes de prod
(`https://api.valariamenu.com`, vérification passive uniquement : GET sur `/`, `/healthz`, `/admin`, `/portal/api/config`).
**Hors périmètre :** le CLI `packages/valaria-code`, l'infrastructure Railway/Cloudflare elle-même.

## Synthèse

| Sévérité | Nombre |
|---|---|
| Critique | 0 |
| Élevée | 2 |
| Moyenne | 4 |
| Faible | 5 |

Aucune injection SQL/NoSQL, aucune XSS exploitable, aucun secret dans le dépôt, `npm audit` : 0 vulnérabilité.
Les deux problèmes les plus graves concernent la **limitation anti-brute-force** : l'OTP email peut être
deviné en parallèle (course sur le compteur de tentatives), et l'IP client est falsifiable si l'origine
Railway est joignable sans passer par Cloudflare.

---

## Élevée

### E1. Course sur le compteur de tentatives OTP → brute-force du code email (prise de compte)
**Fichiers :** `src/portal-api.js:1138-1159` (`/email/verify`), `src/portal-api.js:1281-1297` (`/signup/verify`)

Le code lit `record.attempts`, incrémente en base, puis compare la **valeur lue avant** à `MAX_CODE_ATTEMPTS` :

```js
const record = await getActivePortalEmailCode(db, email);   // attempts = 0
await incrementPortalEmailCodeAttempts(db, record.id);
if (Number(record.attempts) + 1 > MAX_CODE_ATTEMPTS) { ... }   // valeur périmée
```

N requêtes envoyées en parallèle lisent toutes `attempts = 0` et passent toutes la garde. La limite
« 5 essais par code » n'est donc pas une borne réelle. Seule reste la limite par IP (20 / 15 min),
contournable (voir E2) ou répartie sur plusieurs IP. Le code a 6 chiffres et reste valide 10 min. Un
attaquant peut aussi en redemander : `OTP_MAX_PER_EMAIL=0`, donc illimité par défaut, avec une attente
de 30 s et un captcha. Chaque code redemandé redonne une fenêtre d'essais parallèles. Un code deviné
ouvre une session sur le compte de la victime : wallet, création de clé API, achats.

**Correctif :** incrément atomique conditionnel, et décision prise sur la valeur **retournée** :
Mongo `findOneAndUpdate({ id, attempts: { $lt: 5 } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' })`,
SQLite `UPDATE … SET attempts = attempts + 1 WHERE id = ? AND attempts < 5` puis tester `changes === 1`.
Ajouter aussi un plafond par défaut sur `OTP_MAX_PER_EMAIL` (ex. 5 / 15 min).

### E2. IP client falsifiable si l'origine est joignable hors Cloudflare
**Fichiers :** `src/http-utils.js:150-161` (`clientIp`), `src/portal-api.js:281-285` (`requestIp`), `src/currency.js:117` (`CF-IPCountry`)

En production, `TRUST_PROXY=1` et `TRUST_CLOUDFLARE=1` (confirmé par `/healthz`). L'IP est alors prise
dans `CF-Connecting-IP`, sinon dans le **premier** élément de `X-Forwarded-For`. Ces deux valeurs sont
fixées par le client si la requête n'est pas passée par Cloudflare. C'est le cas, par exemple, via le
domaine public `*.up.railway.app`. Un attaquant qui change d'IP à chaque requête contourne alors
toutes les protections fondées sur l'IP :
- brute-force du mot de passe admin (`admin-api.js:298`, 10 essais / 15 min / IP) ;
- brute-force OTP (E1) et rate-limit global `IP_RATE_LIMIT_PER_MIN` ;
- règle « 1 compte d'essai par IP » (multiplication des crédits gratuits) ;
- choix de la devise de paiement via `CF-IPCountry`.

**Correctif :** désactiver le domaine public Railway, ou n'accepter que les connexions issues des
plages IP Cloudflare. Une alternative : un en-tête secret ajouté par une Transform Rule Cloudflare et
vérifié au démarrage de `route()`. Hors Cloudflare, prendre l'élément le plus **à droite** de
`X-Forwarded-For`, celui ajouté par le proxy de confiance, et non le premier.

---

## Moyenne

### M1. Injection de formules dans l'export CSV admin
**Fichier :** `src/admin-api.js:332-335`, `:707-739`

`csvCell` gère les guillemets, mais pas les cellules commençant par `=`, `+`, `-`, `@`, tabulation ou
retour chariot. Or `requestedModel` est choisi librement par tout client API (`"model": "=HYPERLINK(...)"`),
et `clientName` est modifiable via `PUT /portal/api/profile`. À l'ouverture du CSV dans Excel ou
LibreOffice, la formule s'exécute sur le poste de l'administrateur (exfiltration, lien piégé).
**Correctif :** préfixer par `'` toute cellule qui commence par `[=+\-@\t\r]`.

### M2. Hameçonnage par code d'appareil (device flow)
**Fichiers :** `src/portal-api.js:843-960`, `public/device.js`, `public/device.html`

N'importe qui peut lancer `/device/start` et envoyer à une victime le lien
`/device?code=XXXX-XXXX`, avec le code déjà rempli. La page d'approbation ne montre ni le nom de
l'appareil, ni la date, ni l'IP ou le pays de la demande. Un seul clic sur « Autoriser » donne à
l'attaquant un jeton `vlt_` valable **90 jours** sur le compte de la victime.
**Correctif :** afficher le nom de l'appareil, l'heure et le pays de la demande. Ne pas pré-remplir le
code depuis l'URL, ou exiger que l'utilisateur le retape. Ajouter un avertissement explicite (« n'autorisez
que si vous venez de lancer `valaria login` »). Envisager un TTL de jeton plus court avec renouvellement.

### M3. Le proxy relaie toutes les méthodes et tous les chemins avec la clé fournisseur maître
**Fichier :** `src/proxy.js:36-50`, `:575`

Toute requête sous `/v1/*`, `/beta/*` ou `/anthropic/*`, quelle que soit la méthode (GET, PUT, DELETE…),
part vers `provider.baseUrl` avec la clé maître. Seules les requêtes POST passent par la réservation de
crédit. Les ressources éventuelles du compte fournisseur (fichiers, batchs, etc.) sont donc partagées
entre tous les clients. Les appels non-POST ne sont ni plafonnés ni facturés.
**Correctif :** liste blanche explicite `(méthode, chemin)`. Par exemple, POST sur
`chat/completions`, `completions`, `messages`, `responses` et GET sur `models` ; refuser le reste en 404.

### M4. Console admin exposée sur Internet, 2FA optionnelle
**Fichiers :** `src/admin-api.js:411-442`, `src/auth.js:127`

`/admin` est public. Le seul facteur obligatoire est le mot de passe, la TOTP n'est active que si
`ADMIN_TOTP_SECRET` est défini. La limite d'essais est en mémoire et par IP (voir E2). `scryptSync` bloque
la boucle d'événements à chaque essai, ce qui permet de saturer le CPU avec des IP tournantes.
**Correctif :** définir `ADMIN_TOTP_SECRET` en production. Mettre `/admin*` derrière Cloudflare Access
(ou une liste d'IP autorisées). Ajouter un verrou global, indépendant de l'IP, après N échecs.

---

## Faible

| # | Constat | Emplacement | Correctif |
|---|---|---|---|
| F1 | `/healthz` public expose l'ID de la guilde Discord, le type de base, les avertissements de config (dont « IPQS non configuré ») | `src/app.js:353-369` | Réponse publique minimale `{ok:true}`, détail réservé à l'admin |
| F2 | `originAllowed` et `requestOrigin` font confiance à `X-Forwarded-Host` même sans `TRUST_PROXY` | `src/http-utils.js:169-181`, `src/portal-api.js:148-155` | N'utiliser `X-Forwarded-Host` que si `trustProxy`, et toujours renseigner `PUBLIC_BASE_URL` |
| F3 | Maps en mémoire non bornées (`loginAttempts`, `emailSendWindow`, caches fraude, `IpRateLimiter`) : croissance mémoire avec des IP ou emails tournants | `src/portal-api.js:167-175`, `src/admin-api.js:280` | Purge périodique (comme `ipLimiter.prune()`) ou taille maximale |
| F4 | Énumération d'emails : `signup_ip_limit` / `signup_device_limit` / `vpn_detected` ne sont renvoyés que si le compte **n'existe pas** | `src/portal-api.js:1061-1063`, `:1208` | Message générique, ou contrôle reporté après l'envoi du code |
| F5 | Le webhook SasPay ne rapproche que les 10 commandes `pending` les plus récentes : un utilisateur qui crée beaucoup de commandes retarde l'activation des paiements des autres (jusqu'à `/pass/confirm`) | `src/portal-api.js:783-806` | Rapprocher la commande citée dans l'événement (`metadata.order_id` / `checkout_id`), plafonner les commandes `pending` par client |

---

## Points solides constatés

- Mots de passe scrypt, comparaison en temps constant ; jetons de session, clés API et jetons CLI stockés uniquement en SHA-256.
- Clé fournisseur chiffrée AES-256-GCM, jamais renvoyée en clair.
- Cookies `HttpOnly; SameSite=Strict; Secure`, protection CSRF (en-tête personnalisé + contrôle d'`Origin`) sur toutes les mutations.
- CSP stricte sans script inline, `frame-ancestors 'none'`, HSTS, `nosniff`, `COOP`/`CORP` : confirmé en production.
- SQL entièrement paramétré ; filtres Mongo typés et regex échappées.
- Échappement HTML systématique dans `app.js`, `portal.js`, `payment.js` et dans les emails.
- Webhook SasPay : HMAC + fenêtre de 5 min, puis **revérification côté serveur** auprès de SasPay et réclamation idempotente (`claimPaymentOrder`). Le montant est fixé côté serveur.
- Erreurs 500 génériques avec identifiant de requête ; journal d'audit admin.
- `npm audit --omit=dev` : 0 vulnérabilité ; aucun `.env`, base de données ni clé maître dans Git.

## Priorités recommandées

1. **E1** : rendre l'incrément OTP atomique (petit diff, gros gain).
2. **E2** : fermer l'accès direct à l'origine Railway / vérifier la provenance Cloudflare.
3. **M4** : activer `ADMIN_TOTP_SECRET` et Cloudflare Access sur `/admin`.
4. **M1, M3, M2**, puis les points faibles.

---

## État des correctifs (2026-11-19)

| # | Statut | Correctif |
|---|---|---|
| E1 | ✅ Corrigé | Incrément atomique conditionnel (`attempts < 5`) en SQLite et Mongo, décision sur la valeur retournée ; `OTP_MAX_PER_EMAIL` = 5 par défaut |
| E2 | ✅ Corrigé côté code, ⚠️ **action requise** | `ORIGIN_SECRET` : toute requête sans l'en-tête `x-origin-secret` est refusée (403, sauf `/healthz`) ; `X-Forwarded-For` lu à droite ; `CF-IPCountry` et `X-Forwarded-Host` ignorés hors proxy de confiance. **Configurer la Transform Rule Cloudflare + la variable Railway (voir ci-dessous).** |
| M1 | ✅ Corrigé | Cellules CSV commençant par `= + - @ \t \r` préfixées par `'` |
| M2 | ✅ Corrigé | Endpoint `/portal/api/device/info` : la page affiche l'appareil demandeur et l'âge de la demande ; case « j'ai lancé cette connexion » obligatoire ; avertissement explicite ; 30 tentatives / 15 min par compte |
| M3 | ✅ Corrigé | Liste blanche : POST sur `chat/completions`, `completions`, `beta/*completions`, `responses`, `anthropic/v1/messages[/count_tokens]` ; tout le reste → 404 |
| M4 | ✅ Corrigé côté code, ⚠️ **action requise** | Verrou global (50 échecs / 15 min toutes IP), scrypt asynchrone, avertissement au démarrage si `ADMIN_TOTP_SECRET` est vide. **Définir `ADMIN_TOTP_SECRET` ; Cloudflare Access sur `/admin*` recommandé.** |
| F1 | ✅ Corrigé | `/healthz` : `ok`, `name`, `version`, `uptimeSeconds`, `providerConfigured` uniquement |
| F2 | ✅ Corrigé | `X-Forwarded-Host` pris en compte seulement si `TRUST_PROXY=1` |
| F3 | ✅ Corrigé | Purge horaire de tous les compteurs et caches en mémoire (admin + portail) |
| F4 | ✅ Corrigé | Règles d'inscription (IP, appareil, VPN) appliquées à la vérification du code, plus à la demande |
| F5 | ✅ Corrigé | Le webhook rapproche d'abord la commande citée (`metadata.order_id`) ; au plus 5 commandes `pending` par client (les abandonnées sont revérifiées avant refus) |

Non-régression : `test/security.test.js`. Le chemin Mongo de E1 n'est pas couvert par les tests locaux (SQLite uniquement).

### Activer ORIGIN_SECRET (E2)

1. Générer un secret : `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. Cloudflare → *Rules* → *Transform Rules* → *Modify Request Header* → règle sur le hostname `api.valariamenu.com` :
   *Set static* `x-origin-secret` = le secret.
3. Railway → Variables : `ORIGIN_SECRET=<le même secret>`, puis redéployer.
4. Vérifier : `https://api.valariamenu.com/` → 200 ; `https://deepseek-gateway-production.up.railway.app/` → 403 (ou supprimer ce domaine public dans Railway → Settings → Networking).
