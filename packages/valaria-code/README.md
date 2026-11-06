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
valaria preview         # aperçu statique de l'interface
valaria preview --splash # revoir l'animation de démarrage
valaria logout          # oublier cet appareil
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

## Revue de diff

`/diff` ouvre une revue en deux colonnes :

- à gauche, les fichiers modifiés, ajoutés ou supprimés du répertoire ;
- à droite, les lignes `+`/`−` du fichier sélectionné, avec numéros de ligne.

En mode **Studio**, la colonne compte reste à gauche, puis viennent la liste des
fichiers et le diff : tout ce qui concerne les changements est donc à droite.

Une proposition d’écriture de l’agent ouvre automatiquement cette revue ;
`y` autorise, `n` refuse, `↑↓` change de fichier et `PgUp/PgDn` fait défiler.

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

- `Entrée` envoyer un message — il lance l’agent par défaut.
- `/help` lister les commandes.
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
