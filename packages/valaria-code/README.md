# VALARIA Code

Agent de code en terminal, avec une interface plein écran VALARIA.

Il se connecte à l'instance VALARIA Gateway via une **autorisation d'appareil** :
aucune clé API complète n'est demandée ni stockée dans le terminal.

## Installation

```bash
npm install -g valaria-code
valaria login
valaria
```

`valaria login` ouvre le portail VALARIA. Connectez-vous, vérifiez le code affiché
dans le terminal, puis autorisez l'appareil. Après connexion, choisissez
**Claude**, **Codex** ou **DeepSeek** : le modèle retenu est enregistré sur
l'appareil. Le CLI reçoit ensuite un jeton révocable.

L’interface principale est **Focus** par défaut : conversation et composeur
uniquement. Le compte, le pass et les quotas restent consultables avec
`/account` ou `Ctrl+O`, ou dans les interfaces Studio et Compact. Un message
naturel lance directement l’agent : il peut lire et modifier les fichiers, avec
approbation avant écriture et avant commande.

## Commandes

```bash
valaria                 # TUI plein écran
valaria login           # autoriser cet appareil
valaria status          # compte, pass, quotas
valaria models          # modèles disponibles
valaria chat "Bonjour"  # réponse simple sans TUI
valaria --new           # nouvelle conversation (efface la mémoire locale du projet)
valaria preview         # aperçu statique de l'interface
valaria preview --splash # revoir l'animation de démarrage
valaria logout          # oublier cet appareil
```

## Mémoire persistante

La conversation est **sauvegardée automatiquement par projet** dans
`~/.valaria/sessions/` et reprise au prochain lancement de `valaria`.

- une seule commande suffit : tapes simplement ta demande, sans `/agent` ;
- les tours suivants reçoivent l’historique des échanges précédents ;
- `valaria chat "..."` utilise la même mémoire que la TUI ;
- `/new` ou `--new` efface la mémoire du projet courant ;
- seuls les messages utilisateur/assistant sont conservés, sans les détails
  internes des outils ;
- le contexte envoyé au modèle est limité aux derniers échanges pour rester
  rapide et éviter de saturer la fenêtre.

```text
valaria --new
/new
```

## Interfaces

Trois dispositions au choix, sans panneau permanent imposé :

- **Focus** (défaut) : uniquement la conversation et le composeur ;
- **Studio** : compte, pass, quotas et modèle dans une colonne latérale ;
- **Compact** : une ligne de synthèse du compte au-dessus de la conversation.

```bash
valaria --layout studio
valaria preview --layout studio
```

Dans la TUI :

- `/layout focus|studio|compact` ;
- `Ctrl+P` change d’interface ;
- `Ctrl+O` ou `/account` ouvre l’écran compte et quotas ;
- `Échap`/`Entrée` ferme cet écran.

## Modes d’agent

```text
/approval strict   approbation pour chaque écriture et commande
/approval safe     approbation seulement pour les actions dangereuses
/approval full     accès total, aucune approbation
```

Raccourcis :

```text
/1   mode Strict
/2   mode Sécurisé
/3   mode Accès total
Ctrl+G ou Alt+M   cycle entre les trois modes
```

En mode **safe**, les écritures de code ordinaires et les commandes de test sont
autorisées automatiquement ; les fichiers sensibles (`.env`, secrets, lockfiles,
`.github`, Docker) et les commandes destructrices (`rm -rf`, `git reset --hard`,
`git push --force`, `sudo`, `npm publish`…) demandent toujours une approbation.

Le mode est affiché dans la ligne d’état et enregistré avec la configuration.

## Conversation

- `PgUp` / `PgDn` font défiler l’historique de la conversation ;
- l’envoi d’un nouveau message revient automatiquement en bas ;
- la conversation est persistante et reprise après redémarrage ;
- le diff est **visible en permanence** dans la colonne de droite par défaut ;
- `/diff` l’actualise, `/diff off` le masque, `/diff on` le réaffiche ;
- pendant une approbation, le diff reste visible à droite.

## Agent complet

L’agent dispose de :

- lecture et recherche de fichiers, lecture par plage de lignes ;
- écriture complète et **remplacement ciblé** (`replace_in_file`) avec diff ;
- exécution de tests, lint et builds avec approbation ;
- consultation Git (`git_status`, `git_diff`) sans approbation ;
- instructions de projet chargées automatiquement depuis `AGENTS.md`,
  `VALARIA.md`, `CLAUDE.md` ou `.valaria/instructions.md`.

Une demande en langage naturel lance directement l’agent. Les actions
d’écriture et de commande restent soumises au mode d’approbation.

## Revue de diff

`/diff` ouvre une revue compacte :

- les fichiers modifiés, ajoutés ou supprimés sont listés en haut ;
- le diff du fichier sélectionné s’affiche juste en dessous, dans la même colonne ;
- les lignes ajoutées sont vertes, les lignes supprimées rouges, avec numéros de ligne.

En mode **Studio**, la conversation reste au centre et la revue occupe une seule
colonne à droite : liste des fichiers en haut, diff en bas. Les messages
utilisateur et agent restent donc visibles. La revue est visible en permanence
par défaut et se rafraîchit automatiquement.

Une proposition d’écriture de l’agent ouvre automatiquement cette revue ;
`y` autorise, `n` refuse, `↑↓` change de fichier, `d` agrandit/réduit la revue et
`PgUp/PgDn` fait défiler.

## Assets et animations

- logo ASCII VALARIA au démarrage ;
- gradient animé, scanline et apparition progressive du logo ;
- marque `◈` dans l’en-tête ;
- spinner d’agent, curseur de streaming, pulse de connexion et caret ;
- désactivation possible :

```bash
valaria --no-anim
```

ou dans la TUI :

```text
/animations off
/animations on
```

## Dans la TUI

- `Entrée` envoyer un message — il lance l’agent par défaut avec la mémoire du projet.
- `/help` lister les commandes.
- `/new` ou `/clear` repartir d’une conversation vide.
- `/session` afficher le nombre de messages mémorisés.
- `/chat <message>` conversation simple sans outils.
- `/agent <tâche>` relancer explicitement l’agent.
- `/interview`, `/plan <objectif>`, `/review` : parcours guidé proche de Freebuff.
- après chaque réponse, des suggestions `1/2/3` proposent la suite.
- `/files` explorer le projet.
- `/read <fichier>` ajouter un fichier au contexte.
- `/edit <fichier> <instruction>` préparer une modification, avec diff et
  approbation avant écriture.
- `/run <commande>` exécuter une commande après approbation.
- `/models`, `/model`, `/usage`.
- `Ctrl+C` annuler ; `Ctrl+D` quitter.

## Configuration

`~/.valaria/code.json` (0600) contient l'URL, le jeton d'appareil et le modèle.
Les conversations sont dans `~/.valaria/sessions/` (dossier 0700, fichiers 0600).
`VALARIA_API_KEY` reste disponible pour les environnements CI uniquement.

## Variables

- `VALARIA_GATEWAY_URL` : instance (défaut `https://api.valariamenu.com`).
- `VALARIA_HOME` : dossier de configuration.
- `VALARIA_MODEL` : modèle par défaut.
- `NO_COLOR` : désactiver les couleurs.

## Sécurité

- le jeton d'appareil est révocable depuis le portail ;
- aucune écriture ni commande sans approbation dans la TUI ;
- les chemins sont confinés au projet courant ;
- l'interface ne traite que du texte et du code.

Licence MIT.
