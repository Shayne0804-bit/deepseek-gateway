# Audit — module npm « VALARIA Code »

Date : 6 novembre 2026 — version auditée : `3.7.2`
Compte npm vérifié : `ducky12` (connecté, registre public npm, jeton présent)

## 1. Résumé exécutif

Le projet possède déjà un paquet npm (`valaria-gateway`) et un client CLI minimal
(`bin/valaria-gateway.js` + `src/client.js`). Ce client sait se connecter avec une
clé API, afficher un tableau de bord, lister les modèles et envoyer un message.

En revanche, il ne répond pas encore au besoin exprimé :

- il mélange **serveur** et **client** dans le même paquet ;
- son interface interactive est un simple `readline` dans le terminal courant,
  sans écran plein, sans panneaux, sans identité visuelle forte ;
- il n’y a **pas de connexion depuis le site** : la clé est saisie en clair ou
  passée en argument ;
- il ne fait pas de **coding agent** : pas de contexte projet, pas de lecture /
  édition de fichiers, pas de diff, pas d’exécution de commandes, pas de streaming ;
- il ne peut pas remplacer Claude Code ou Codex CLI aujourd’hui.

Recommandation : créer un **paquet séparé `valaria-code`**, avec :

1. une **autorisation par appareil** depuis le portail web (le site reste la
   source de vérité pour le compte, le pass et la révocation) ;
2. une **TUI plein écran personnalisée VALARIA** (pas le prompt PowerShell/CMD) ;
3. un **agent de code local** : fichiers, recherche, modifications avec diff,
   commandes approuvées, tests, streaming ;
4. un **SDK** exporté pour les intégrations programmatiques.

Le nom `valaria-code` est **libre sur npm** (404 vérifié). `valaria` est déjà pris.

## 2. Surface auditée

### 2.1 Site public

| Surface | Route | Rôle audité |
|---|---|---|
| Landing | `/` | Positionnement, inscription, connexion |
| Inscription | `/signup` | Création de compte par email |
| Connexion | `/portal` | Clé API ou code email |
| Portail | `/portal` | Pass, clé, consommation, requêtes, réglages, guide |
| Admin | `/admin` | Clés, quotas, journaux, réglages |

Le portail contient déjà : profil, gestion de la clé, quotas, consommation,
historique, pass, réglages et guide d’intégration.

### 2.2 API publique

- Base URL : `https://api.valariamenu.com/v1`
- Base Anthropic / Claude Code : `https://api.valariamenu.com/anthropic`
- Authentification actuelle : `Authorization: Bearer sk-dsk-…` ou `x-api-key`
- Routes : Chat Completions, Responses, Messages Anthropic, découverte de modèles
- Modèles exposés : noms texte/code (Claude, Fable, GPT/Codex), routés par la
  passerelle ; aucune capacité image/audio/vidéo.

### 2.3 API du portail

Routes utiles au futur module :

| Route | Méthode | Session portail | Clé API acceptée |
|---|---|---|---|
| `/portal/api/login` | POST | non | — |
| `/portal/api/me` | GET | oui | **oui** (`Bearer`) |
| `/portal/api/logs` | GET | oui | **oui** |
| `/portal/api/email/*` | POST | non | — |
| `/portal/api/key` | POST | oui | non |
| `/portal/api/key/rotate` | POST | oui | non |
| `/portal/api/profile` | PUT | oui | non |
| `/portal/api/config` | GET | non | — |
| `/portal/api/currency` | GET | non | — |

Sécurité existante : cookie `dsk_portal` HttpOnly, `SameSite=Strict`, CSRF
`x-requested-with`, vérification d’origine, limitation IP et tentatives de
connexion.

### 2.4 Client npm existant

Constats dans `bin/valaria-gateway.js` et `src/client.js` :

- login par `--key` ou variable d’environnement ;
- configuration dans `~/.valaria-gateway/client.json` (0600) ;
- tableau de bord texte, sparkline, quotas, logs ;
- commandes `status`, `ask`, `models`, `logs`, `open`, `ui`, `logout` ;
- `ask` est un appel unique non streamé ;
- aucune lecture de fichiers, aucun outil, aucun historique de conversation,
  aucun diff, aucune exécution de commande ;
- interface `ui` = `readline` + effacement d’écran, pas une vraie TUI ;
- paquet actuel = client + serveur + `public/` + `mongodb` ; pas adapté à un
  module de code léger.

### 2.5 Empaquetage et compte npm

- Compte npm : **`ducky12` connecté**.
- `valaria-gateway` : nom disponible (404 npm).
- `valaria-code` : nom disponible (404 npm).
- `valaria` : déjà publié par un tiers ; à éviter.
- Scope `@valaria` non possédé par le compte ; ne pas compter dessus sans créer
  l’organisation npm.
- Le `package.json` actuel n’a pas de champ `private`, mais son `files` inclut
  tout le serveur. Un nouveau paquet doit avoir une liste blanche stricte.

## 3. Ce qui doit passer par une connexion au site

### Obligatoire côté site

| Action | Pourquoi |
|---|---|
| Créer un compte | identité, email, anti-abus |
| Se connecter au portail | session utilisateur |
| Obtenir / gérer son pass | paiement, quotas, date de fin |
| Créer, régénérer, révoquer la clé API | secret affiché une seule fois |
| **Approuver un appareil CLI** | le site est le point d’autorisation sûr |
| Révoquer un appareil | couper l’accès perdu |
| Consulter / payer le pass | facturation |
| Admin | console opérateur |

### Possible sans site après autorisation

| Action | Canal |
|---|---|
| Chat et génération de code | API `/v1` avec jeton d’appareil |
| Lecture / écriture locale de fichiers | outils locaux du module |
| Exécution de tests / commandes | approbation locale |
| Affichage des quotas en direct | `/portal/api/me` avec jeton |
| Historique local de session | fichiers locaux du module |

**Conclusion :** le module doit demander le site uniquement pour **se connecter,
approuver l’appareil et gérer le compte/pass** ; ensuite le travail de code doit
être autonome et ne pas rouvrir le navigateur.

## 4. Flux d’authentification recommandé

### Device Authorization Flow (style OAuth)

1. L’utilisateur lance `valaria login`.
2. Le module appelle `POST /portal/api/device/start` et reçoit :
   - `device_code` (secret, jamais affiché) ;
   - `user_code` (court, affiché) ;
   - `verification_uri` (`https://api.valariamenu.com/device`) ;
   - `expires_in` (600 s) et `interval` (5 s).
3. Le module ouvre le navigateur sur `/device?code=…` (ou affiche le code).
4. Si l’utilisateur n’est pas connecté au portail, le site le redirige vers
   `/portal?next=/device?code=…`.
5. Après connexion, la page `/device` affiche le code, le nom de l’appareil et
   un bouton **Autoriser**.
6. Le module interroge `POST /portal/api/device/token` toutes les 5 s.
7. Après approbation, le serveur renvoie un **jeton d’appareil** opaque
   (`vlt_…`), stocké haché en base et à durée limitée (90 jours par défaut).
8. Le module stocke le jeton dans `~/.valaria/code.json` (0600) et ne l’affiche
   jamais.
9. Le portail propose une page **Appareils connectés** pour révoquer.

### Pourquoi pas seulement une clé API ?

- une clé API complète n’est affichée qu’une fois ;
- la faire recopier à la main est peu sûr (historique, processus, capture) ;
- la rotation de clé casserait tous les appareils ;
- un jeton d’appareil est **révocable indépendamment**, traçable et sans
  exposer la clé API.

### Mode secours

Pour CI ou automatisation, accepter `VALARIA_API_KEY` en variable
d’environnement uniquement (jamais `--key` en argument de commande). Le login
interactif normal reste le device flow.

## 5. Contrat d’interface — TUI personnalisée

Direction : **Signal Ledger / Terminal**, déclinée du site existant.

- Pas de prompt brut type PowerShell/CMD.
- Écran alternatif plein terminal (`\x1b[?1049h`), propre, stable, sans
  scrollback parasite.
- Palette graphite/jade/ambre, accents `#7fe3aa` et `#f0c674`.
- Monospace, cadres fins, badges `[ ]`, logo V-Node en en-tête.
- Trois zones : conversation, activité/diff, composeur.
- Animation utile uniquement : curseur de streaming, pulse de connexion,
  transition de panneau.

### Maquette logique

```text
┌ VALARIA CODE ─────────────────────────────── v0.1.0 ─┐
│ V  api.valariamenu.com  ·  Créateur  ·  ● connecté    │
├──────────────────────────────────┬───────────────────┤
│ Vous                             │ ACTIVITÉ          │
│  explique ce fichier             │  lecture app.js   │
│                                  │  recherche tests  │
│ VALARIA                          │  diff proposé     │
│  ... réponse en streaming ...    │                   │
│                                  │                   │
├──────────────────────────────────┴───────────────────┤
│ > _                                                  │
│  Entrée envoyer · / commandes · Ctrl+C annuler       │
└──────────────────────────────────────────────────────┘
```

### États obligatoires

| État | Déclencheur | Feedback | Action |
|---|---|---|---|
| Connexion | aucun jeton | écran d’accueil + code | `valaria login` / ouvrir le site |
| Appareil en attente | device flow | code + lien + timer | attends / annule |
| Vide | nouveau projet | actions rapides | ouvrir un fichier, poser une question |
| Chargement | réponse en cours | spinner + annulation | Ctrl+C |
| Streaming | token reçu | texte progressif | stop |
| Permission | commande ou écriture | diff/commande + allow once/session/deny | approuver |
| Erreur | réseau/quota | message + `R` réessayer / `L` login | récupération |
| Succès | patch appliqué | diff + undo | continuer |
| Partiel | contexte tronqué | badge « contexte partiel » | réduire / ajouter fichiers |

### Commandes prévues

`/login`, `/logout`, `/model`, `/models`, `/usage`, `/files`, `/diff`, `/apply`,
`/undo`, `/plan`, `/clear`, `/help`, `/quit`.

Raccourcis : `Ctrl+K` palette, `Ctrl+P` fichiers, `Ctrl+D` diff, `Ctrl+C`
annuler, `Ctrl+L` rafraîchir.

## 6. Périmètre fonctionnel du module

### MVP

1. Authentification device flow depuis le site.
2. TUI plein écran VALARIA.
3. Chat streamé avec modèles texte/code.
4. Contexte projet : `@fichier`, lecture, recherche, liste.
5. Agent local : proposer/écrire des fichiers avec **diff et approbation**.
6. Exécution de commandes avec **approbation** (tests, lint) et capture.
7. Quotas, modèle, pass et appareil visibles dans la TUI.
8. Configuration locale et révocation depuis le site.
9. SDK exporté pour usage programmatique.

### Hors périmètre explicite

- génération d’images, audio ou vidéo ;
- navigation web autonome ;
- exécution de commandes sans approbation ;
- publication de secrets ou de clés dans les logs ;
- dépendance à Claude Code ou Codex CLI.

## 7. Architecture recommandée

### Séparer les paquets

```text
valaria-gateway (serveur / auto-hébergement)   → existant, garder pour l’opérateur
valaria-code     (client npm / SDK / TUI)      → nouveau package public
```

Le paquet `valaria-code` ne doit **pas** contenir `server.js`, `public/`,
`data/`, les tests, `.env` ou `mongodb`.

```text
valaria-code/
  package.json          # bin: valaria, valaria-code ; exports SDK
  bin/valaria.js        # démarrage TUI / commandes
  src/auth/device.js    # device flow + stockage jeton
  src/api/client.js     # fetch, streaming SSE, erreurs, retry
  src/config/store.js   # ~/.valaria/code.json, 0600
  src/tui/              # app, renderer, theme, input, keymap
  src/agent/loop.js     # conversation + outils
  src/tools/            # fs, search, shell, git, diff
  src/index.js          # SDK public
  README.md
  LICENSE
```

### Serveur à ajouter pour le device flow

- Tables : `device_codes`, `cli_tokens` (hash, client, dates, révocation).
- Routes :
  - `POST /portal/api/device/start`
  - `POST /portal/api/device/approve` (session + CSRF)
  - `POST /portal/api/device/token`
  - `GET /portal/api/devices` (session)
  - `DELETE /portal/api/devices/:id` (session)
- Page `GET /device` (login requise pour approuver).
- Le proxy `/v1` et `/portal/api/me` doivent accepter le jeton `vlt_…` en plus
  des clés `sk-dsk-…`.
- Rate limits dédiés au polling et à la création de codes.

### Sécurité

- jetons et codes hachés en base, jamais en clair ;
- code utilisateur court à forte entropie, usage unique, expiration 10 min ;
- jeton d’appareil 90 jours, révocable, `last_used_at` ;
- configuration locale 0600, aucune clé dans les arguments ;
- approbation explicite des écritures et commandes ;
- protection CSRF/origine déjà présente à réutiliser ;
- audit des connexions/déconnexions d’appareils ;
- jeton jamais loggé, expurgé des erreurs.

## 8. Ce qui est nécessaire côté site avant le module

1. Page `/device` + redirection `next` après connexion.
2. Endpoints device + tables + tests.
3. Section **Appareils connectés** dans `/portal` (révoquer).
4. Acceptation du jeton CLI par le proxy et `/me`.
5. `PUBLIC_BASE_URL` / `valaria.defaultUrl` = `https://api.valariamenu.com`.
6. Tests : device expiré, mauvais code, double approbation, révocation,
   polling trop rapide, CSRF, jeton accepté/rejeté.
7. Preuves de rendu sur `/device` et la TUI.

## 9. Plan de réalisation proposé

### Phase 0 — Auth site (petit lot, bloquant)

- DB device codes + CLI tokens.
- Routes et page `/device`.
- Acceptation jeton dans le proxy.
- Page appareils connectés.
- Tests de sécurité.

### Phase 1 — Fondation du package

- Nouveau `valaria-code`, zéro dépendance si possible.
- `login` device flow, config 0600.
- Client API + streaming SSE.
- TUI coquille + thème + états.

### Phase 2 — Agent de code

- Contexte fichier, recherche, `@fichier`.
- Diff, approbation, apply/undo.
- Commandes approuvées, tests.
- Gestion contexte/tokens/quotas.

### Phase 3 — Finition et publication

- README, exemples, captures TUI.
- `npm pack --dry-run`, tests, `npm audit` (si dépendances).
- `npm publish --access public` sur `valaria-code`.
- Vérification `npx valaria-code --version` et parcours login réel.

## 10. Risques et décisions à valider

| Décision | Recommandation |
|---|---|
| Nom npm | **`valaria-code`** (libre) |
| Binaire | `valaria` (et alias `valaria-code`) |
| Interface | **TUI plein écran** maison, pas de shell brut |
| Auth | device flow site + jeton révocable |
| Mode CI | `VALARIA_API_KEY` en environnement uniquement |
| Dépendances TUI | Node natif d’abord ; aucune dépendance pour le MVP |
| Package serveur | inchangé, séparé du package client |
| Périmètre modèle | texte/code uniquement |

### Décision retenue

**A — TUI plein écran dans le terminal**, confirmée par l’utilisateur.

## 11. État d’implémentation (6 novembre 2026)

Implémenté :

- tables `device_codes` et `cli_tokens` (SQLite + MongoDB) ;
- endpoints `/portal/api/device/start`, `/token`, `/approve`, `/devices` et révocation ;
- page `/device` avec connexion au portail et conservation du code ;
- section **Appareils connectés** dans `/portal` ;
- acceptation des jetons `vlt_…` par le proxy `/v1` et `/portal/api/me` ;
- package `packages/valaria-code` version `0.6.0` :
  - `valaria login` device flow, puis choix **Claude / Codex / DeepSeek** et du modèle ;
  - agent par défaut : un message naturel lit, modifie et teste avec approbation ;
  - TUI plein écran avec trois interfaces **Focus / Studio / Compact** ;
  - Focus organisé comme la démo Freebuff : titre projet, transcript, saisie, ligne modèle/aide ;
  - assets de marque : logo ASCII, `◈`, spinner, pulse, splash animé ;
  - compte, pass, quotas et crédit consultables via `/account` ou `Ctrl+O` ;
  - parcours `/interview`, `/plan`, `/review` et suggestions `1/2/3` après réponse ;
  - client API SSE ;
  - chat, `/files`, `/read`, `/edit`, `/run`, `/models`, `/usage` ;
  - `/agent <tâche>` : boucle agentique multi-étapes (lecture → patch → commande)
    avec approbation avant écriture et exécution ;
  - config `~/.valaria/code.json` en 0600 ;
  - SDK exporté.
- tests : device flow, révocation, jeton CLI, package (config/API/auth/outils/TUI/layouts/assets/splash/agent).

Publication :

- **`valaria-code@0.4.0` est publié sur npm** (dernière version : `latest`) ;
- `0.6.0` est prête et testée, mais sa publication interactive attend la validation 2FA ;
- propriétaire : `ducky12` ;
- installation de la 0.4.0 depuis le registre vérifiée.

Le parcours `valaria login` réel nécessite une approbation humaine sur `/device` ;
le flux complet (démarrage → approbation → jeton → `/v1/models` → révocation) a
été testé de bout en bout contre la passerelle.

### Limite actuelle du MVP

L’agent multi-étapes est implémenté dans `/agent` avec approbation des écritures
et commandes. Il dépend du support des tool calls par le modèle servi ; si un
modèle ne les expose pas, le mode `/edit` assisté reste disponible.


