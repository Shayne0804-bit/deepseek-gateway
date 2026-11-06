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
**Claude** ou **Codex** : le modèle retenu est enregistré sur l'appareil.
Le CLI reçoit ensuite un jeton révocable.

L’interface principale affiche en permanence le compte, le pass, les barres de
quotas et le modèle. Un message naturel lance directement l’agent : il peut lire
et modifier les fichiers, avec approbation avant écriture et avant commande.

## Commandes

```bash
valaria                 # TUI plein écran
valaria login           # autoriser cet appareil
valaria status          # compte, pass, quotas
valaria models          # modèles disponibles
valaria chat "Bonjour"  # réponse simple sans TUI
valaria preview         # aperçu statique de l'interface
valaria logout          # oublier cet appareil
```

## Dans la TUI

- `Entrée` envoyer un message — il lance l’agent par défaut.
- `/help` lister les commandes.
- `/chat <message>` conversation simple sans outils.
- `/agent <tâche>` relancer explicitement l’agent.
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
