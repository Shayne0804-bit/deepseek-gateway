# Bot Discord VALARIA

Le bot vit dans `src/discord/` et démarre avec `server.js` lorsque le token et
l’identifiant du serveur sont configurés. Il ne possède aucun intent privilégié.

## Ce qu’il crée au démarrage

Catégorie **｜💠｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀 𝐆𝐀𝐓𝐄𝐖𝐀𝐘** :

| Salon | Rôle |
|---|---|
| `｜💠｜𝐖𝐄𝐋𝐂𝐎𝐌𝐄` | accueil, liens vers le site et l’espace |
| `｜📢｜𝐀𝐍𝐍𝐎𝐔𝐍𝐂𝐄𝐌𝐄𝐍𝐓𝐒` | annonces officielles, lecture seule |
| `｜📡｜𝐒𝐓𝐀𝐓𝐔𝐒` | panneau de statut actualisé toutes les 5 minutes |
| `｜💬｜𝐆𝐄𝐍𝐄𝐑𝐀𝐋` | discussion générale |
| `｜🛟｜𝐒𝐔𝐏𝐏𝐎𝐑𝐓` | entraide et questions |
| `｜🔌｜𝐀𝐏𝐈` | documentation API OpenAI / Anthropic |
| `｜⌨️｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀-𝐂𝐎𝐃𝐄` | documentation complète du CLI |
| `｜🚨｜𝐑𝐄𝐏𝐎𝐑𝐓𝐒` | incidents, abus, facturation |

Les salons existants sont conservés. Le bot renomme les anciens noms simples vers
les noms stylés, met à jour les sujets et permissions, puis publie ou met à jour
toute la documentation dans les salons concernés. Les documents sont épinglés et
identifiés par un marqueur pour éviter les doublons au redémarrage.

### Documentation publiée

| Salon | Contenu |
|---|---|
| `｜💠｜𝐖𝐄𝐋𝐂𝐎𝐌𝐄` | présentation, liens, règles |
| `｜📢｜𝐀𝐍𝐍𝐎𝐔𝐍𝐂𝐄𝐌𝐄𝐍𝐓𝐒` | annonce de lancement |
| `｜📡｜𝐒𝐓𝐀𝐓𝐔𝐒` | panneau live + endpoint `/healthz` |
| `｜💬｜𝐆𝐄𝐍𝐄𝐑𝐀𝐋` | règles de discussion |
| `｜🛟｜𝐒𝐔𝐏𝐏𝐎𝐑𝐓` | procédure de support et diagnostic |
| `｜🔌｜𝐀𝐏𝐈` | URLs, auth, cURL, Node.js, Python, endpoints, modèles, quotas et erreurs |
| `｜⌨️｜𝐕𝐀𝐋𝐀𝐑𝐈𝐀-𝐂𝐎𝐃𝐄` | installation, login appareil, interfaces, commandes, diff et modes d’approbation |
| `｜🚨｜𝐑𝐄𝐏𝐎𝐑𝐓𝐒` | modèle de signalement et sécurité |

Les messages sont en anglais, illustrés par les captures VALARIA Code, et mis à jour lorsque leur contenu change, sans être dupliqués.

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
/help           liens et commandes
/ping           latence
```

## Déploiement

Le bot démarre automatiquement avec le serveur si les variables sont présentes.
En Docker/Railway, ajouter les variables au service ; `Dockerfile` copie déjà
`src/` et `npm ci` installe `discord.js`. Une erreur Discord est journalisée mais
ne fait jamais tomber l’API.
