# Bot Discord VALARIA

Le bot vit dans `src/discord/` et démarre avec `server.js` lorsque le token et
l’identifiant du serveur sont configurés. Il ne possède aucun intent privilégié.

## Ce qu’il crée au démarrage

Catégorie **VALARIA GATEWAY** :

| Salon | Rôle |
|---|---|
| `#bienvenue` | accueil, liens vers le site et l’espace |
| `#annonces` | annonces officielles, lecture seule |
| `#statut` | panneau de statut actualisé toutes les 5 minutes |
| `#support` | entraide et questions |
| `#api` | endpoints OpenAI / Anthropic |
| `#valaria-code` | installation et usage du CLI |
| `#signalements` | incidents, abus, facturation |

Les salons existants sont conservés. Le bot met à jour le sujet, la catégorie et
les permissions sans supprimer les messages. Les messages d’accueil ne sont
envoyés que lors de la création d’un salon.

## Configuration

```dotenv
DISCORD_ENABLED=1
DISCORD_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CATEGORY_NAME=VALARIA GATEWAY
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
