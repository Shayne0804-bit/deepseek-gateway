# Bot Discord VALARIA

Le bot vit dans `src/discord/` et démarre avec `server.js` lorsque le token et
l’identifiant du serveur sont configurés. Il ne possède aucun intent privilégié.

## Ce qu’il crée au démarrage

Catégorie **｜💠｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀 𝐆𝐀𝐓𝐄𝐖𝐀𝐘** :

| Salon | Rôle |
|---|---|
| `｜💠｜𝐛𝐢𝐞𝐧𝐯𝐞𝐧𝐮𝐞` | accueil, liens vers le site et l’espace |
| `｜📢｜𝐚𝐧𝐧𝐨𝐧𝐜𝐞𝐬` | annonces officielles, lecture seule |
| `｜📡｜𝐬𝐭𝐚𝐭𝐮𝐭` | panneau de statut actualisé toutes les 5 minutes |
| `｜💬｜𝐠𝐞𝐧𝐞𝐫𝐚𝐥` | discussion générale |
| `｜🛟｜𝐬𝐮𝐩𝐩𝐨𝐫𝐭` | entraide et questions |
| `｜🔌｜𝐚𝐩𝐢` | documentation API OpenAI / Anthropic |
| `｜⌨️｜𝐯𝐚𝐥𝐚𝐫𝐢𝐚-𝐜𝐨𝐝𝐞` | documentation complète du CLI |
| `｜🚨｜𝐬𝐢𝐠𝐧𝐚𝐥𝐞𝐦𝐞𝐧𝐭𝐬` | incidents, abus, facturation |

Les salons existants sont conservés. Le bot renomme les anciens noms simples vers
les noms stylés, met à jour les sujets et permissions, puis publie ou met à jour
toute la documentation dans les salons concernés. Les documents sont épinglés et
identifiés par un marqueur pour éviter les doublons au redémarrage.

### Documentation publiée

| Salon | Contenu |
|---|---|
| `#bienvenue` | présentation, liens, règles |
| `#annonces` | annonce de lancement |
| `#statut` | panneau live + endpoint `/healthz` |
| `#général` | règles de discussion |
| `#support` | procédure de support et diagnostic |
| `#api` | URLs, auth, cURL, Node.js, Python, endpoints, modèles, quotas et erreurs |
| `#valaria-code` | installation, login appareil, interfaces, commandes, diff et modes d’approbation |
| `#signalements` | modèle de signalement et sécurité |

Les messages sont mis à jour lorsque leur contenu change, sans être dupliqués.

## Configuration

```dotenv
DISCORD_ENABLED=1
DISCORD_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CATEGORY_NAME=｜💠｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀 𝐆𝐀𝐓𝐄𝐖𝐀𝐘
DISCORD_SYNC_CHANNELS=1
DISCORD_SITE_URL=https://api.valariamenu.com
```

`DISCORD_SITE_URL` est facultatif ; `PUBLIC_BASE_URL` sert de valeur par défaut.

## Permissions Discord nécessaires

Inviter le bot avec :

- Gérer les salons ;
- Envoyer des messages ;
- Intégrer des liens ;
- Lire l’historique des messages ;
- Gérer les messages (épinglage de la documentation) ;
- Utiliser les commandes d’application.

Aucun intent privilégié (`Message Content`, `Members`) n’est requis.

## Commandes

```text
/status         état, version et base de données de la passerelle
/api            URL OpenAI et Anthropic
/valaria-code   installation et commandes du CLI
/aide           liens et commandes
/ping           latence
```

## Déploiement

Le bot démarre automatiquement avec le serveur si les variables sont présentes.
En Docker/Railway, ajouter les variables au service ; `Dockerfile` copie déjà
`src/` et `npm ci` installe `discord.js`. Une erreur Discord est journalisée mais
ne fait jamais tomber l’API.
