/**
 * Documentation publiée par le bot dans les salons Discord.
 * Chaque entrée est un embed Discord (titre + description Markdown).
 * Le bot ajoute un marqueur en footer pour ne pas republier au redémarrage.
 */

function code(language, value) {
  return `\`\`\`${language}\n${value}\n\`\`\``;
}

function siteLinks(site) {
  return `[Site](${site}) · [Mon espace](${site}/portal) · [Créer un compte](${site}/signup)`;
}

export function channelDocs(key, site) {
  if (key === 'welcome') {
    return [
      {
        title: 'Bienvenue dans VALARIA Gateway',
        description: [
          'Une seule clé fournisseur reste côté serveur. Chaque personne reçoit une clé dérivée, des quotas et un suivi de consommation.',
          '',
          '**Deux surfaces**',
          '`#api` — API compatible OpenAI et Anthropic pour vos scripts et SDK.',
          '`#valaria-code` — l’agent de code dans le terminal, avec conversation, diff et approbations.',
          '',
          '**Commencer**',
          `1. Créez votre espace : ${siteLinks(site)}`,
          '2. Ouvrez `#api` ou `#valaria-code` selon votre usage.',
          '3. Posez vos questions dans `#support`.',
          '',
          '> Ne partagez jamais une clé API complète ni un jeton `vlt_…` dans le Discord.',
        ].join('\n'),
      },
      {
        title: 'Règles du serveur',
        description: [
          '**Respect** — pas d’insulte, de spam ni de publicité non sollicitée.',
          '**Sécurité** — aucune clé, aucun secret, aucun mot de passe dans les salons.',
          '**Support** — décrivez votre problème avec le contexte utile : date, endpoint, code d’erreur.',
          '**Signalements** — utilisez `#signalements` pour les incidents et abus.',
          '',
          'Le staff peut déplacer ou supprimer un message non conforme.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'announcements') {
    return [
      {
        title: 'Annonces VALARIA',
        description: [
          'Ce salon publie les nouveautés du site, de l’API et de VALARIA Code.',
          '',
          `**Première annonce**`,
          'VALARIA Gateway est disponible en production. La landing, le portail, la connexion par appareil et l’agent de code sont en ligne.',
          '',
          `[Découvrir le site](${site}) · [Ouvrir mon espace](${site}/portal)`,
          '',
          'Les annonces sont verrouillées : les discussions se poursuivent dans `#support`.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'status') {
    return [
      {
        title: 'Statut du service',
        description: [
          'Ce salon affiche automatiquement l’état de la passerelle toutes les cinq minutes.',
          '',
          'Endpoint de supervision public : `GET /healthz`',
          `[Voir le site](${site})`,
          '',
          'En cas d’incident, ouvrez un message dans `#signalements` avec l’heure et le message d’erreur.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'general') {
    return [
      {
        title: 'Discussion générale',
        description: [
          'Bienvenue dans le salon de discussion VALARIA.',
          '',
          'Pour une question d’intégration, préférez `#support`.',
          'Pour un incident de production, utilisez `#signalements`.',
          '',
          `[Site](${site}) · [Mon espace](${site}/portal)`,
          'Aucune clé API, aucun secret et aucun token ne doivent apparaître ici.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'support') {
    return [
      {
        title: 'Support VALARIA',
        description: [
          'Posez votre question avec un maximum de contexte utile.',
          '',
          '**À fournir**',
          '• la date et l’heure du problème ;',
          '• le client utilisé (SDK, cURL, Codex, Claude Code, VALARIA Code) ;',
          '• le modèle demandé ;',
          '• le code HTTP et le message d’erreur ;',
          '• votre nom de compte (jamais votre clé complète).',
          '',
          '**À ne pas fournir**',
          '• une clé `sk-dsk-…` complète ;',
          '• un jeton d’appareil `vlt_…` ;',
          '• un mot de passe.',
          '',
          'Nous pouvons vous aider à révoquer ou régénérer une clé depuis l’espace utilisateur.',
        ].join('\n'),
      },
      {
        title: 'Raccourcis de diagnostic',
        description: [
          `Vérifiez d’abord le statut : [Mon espace](${site}/portal) · [Site](${site})`,
          '',
          '**Erreur 401** — clé absente ou invalide. Vérifiez l’en-tête `Authorization: Bearer …`.',
          '**Erreur 403** — accès désactivé ou pass expiré. Ouvrez **Mon pass**.',
          '**Erreur 429** — ralentissez et respectez `Retry-After`.',
          '**Erreur 402 / quota** — crédit ou quota épuisé. Consultez **Consommation**.',
          '',
          'Si le problème persiste, indiquez le code exact et l’heure.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'api') {
    return [
      {
        title: 'API VALARIA · connexion',
        description: [
          `**URL OpenAI compatible**\n\`${site}/v1\`\n\n**URL Anthropic Messages**\n\`${site}/anthropic\``,
          '',
          '**Authentification**',
          'Clé personnelle `sk-dsk-…`, créée dans **Mon espace → Mes clés API**.',
          'La clé complète n’est affichée qu’une fois ; elle est révocable et régénérable.',
          '',
          '```http\nAuthorization: Bearer VOTRE_CLE_API\nContent-Type: application/json\n```',
          '',
          'Pour Anthropic : `x-api-key: VOTRE_CLE_API` et `anthropic-version: 2023-06-01`.',
          `[Guide d’intégration](${site}/portal)`,
        ].join('\n'),
      },
      {
        title: 'Premier appel · cURL',
        description: [
          code('bash', `curl ${site}/v1/chat/completions \\
  -H "Authorization: Bearer VOTRE_CLE_API" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-opus-5.5",
    "messages": [{"role":"user","content":"Bonjour"}]
  }'`),
          '',
          'Réponse standard OpenAI. Ajoutez `"stream": true` pour SSE.',
        ].join('\n'),
      },
      {
        title: 'Premier appel · Node.js et Python',
        description: [
          '**Node.js — SDK OpenAI**',
          code('js', `import OpenAI from "openai";
const client = new OpenAI({
  apiKey: "VOTRE_CLE_API",
  baseURL: "${site}/v1"
});
const res = await client.chat.completions.create({
  model: "claude-opus-5.5",
  messages: [{ role: "user", content: "Bonjour" }]
});
console.log(res.choices[0].message.content);`),
          '',
          '**Python — SDK OpenAI**',
          code('python', `from openai import OpenAI
client = OpenAI(api_key="VOTRE_CLE_API", base_url="${site}/v1")
res = client.chat.completions.create(
    model="claude-opus-5.5",
    messages=[{"role":"user","content":"Bonjour"}]
)
print(res.choices[0].message.content)`),
        ].join('\n'),
      },
      {
        title: 'Endpoints, modèles et limites',
        description: [
          '**Endpoints**',
          '`POST /v1/chat/completions` — chat texte/code, streaming SSE possible.',
          '`GET /v1/models` — modèles disponibles pour votre clé.',
          '`POST /anthropic/v1/messages` — protocole Anthropic Messages.',
          '',
          '**Modèles exposés**',
          '`claude-opus-5.5` · `claude-opus-5` · `fable-5.1` · `fable-5` · `gpt-5` · `deepseek-flash`',
          '',
          '**En-têtes de quota**',
          '`x-quota-tokens-remaining` · `x-quota-requests-remaining` · `x-quota-usd-remaining`',
          '',
          '**Erreurs utiles**',
          '`401` clé absente/invalide · `403` accès ou pass désactivé · `404` modèle/route inconnue · `429` débit trop élevé · `402` quota/crédit épuisé.',
          '',
          `[Guide complet](${site}/portal)`,
        ].join('\n'),
      },
    ];
  }

  if (key === 'valaria-code') {
    return [
      {
        title: 'VALARIA Code · installation',
        description: [
          'L’agent de code dans le terminal. Connexion par appareil : aucune clé API complète n’est saisie dans le terminal.',
          '',
          '**Prérequis** : Node.js 20+.',
          code('bash', 'npm install -g valaria-code\nvalaria login\nvalaria'),
          '',
          'Après `valaria login`, le navigateur ouvre `/device`. Connectez-vous, vérifiez le code, approuvez puis choisissez **Claude**, **Codex** ou **DeepSeek**.',
          '',
          `[Guide CLI](${site}/portal) · [Site](${site})`,
        ].join('\n'),
      },
      {
        title: 'Interface et commandes',
        description: [
          '**Interfaces**',
          '`Focus` — conversation + diff permanent.',
          '`Studio` — compte, quotas, conversation et diff.',
          '`Compact` — synthèse du compte.',
          '',
          'Dans la TUI :',
          '`/help` aide · `/files` projet · `/read` contexte · `/edit` patch · `/run` commande',
          '`/models` · `/model` · `/usage` · `/account` · `/layout` · `/diff`',
          '`/interview` · `/plan` · `/review`',
          '',
          '`PgUp/PgDn` défile l’historique · `Ctrl+O` compte · `Ctrl+P` interface.',
        ].join('\n'),
      },
      {
        title: 'Diff et modes d’approbation',
        description: [
          'Le diff reste visible dans la colonne de droite : fichiers modifiés en haut, lignes `+`/`−` en bas.',
          '',
          '**Modes**',
          '`Strict` — chaque écriture et commande demandent `y`/`n`.',
          '`Sécurisé` — approbation seulement pour fichiers sensibles et commandes dangereuses.',
          '`Accès total` — aucune approbation.',
          '',
          'Raccourcis :',
          '`/1` Strict · `/2` Sécurisé · `/3` Accès total',
          '`Ctrl+G` ou `Alt+M` cycle des modes.',
          '',
          'Une approbation affiche le patch, puis accepte `y` ou refuse `n`.',
        ].join('\n'),
      },
      {
        title: 'Sécurité et dépannage',
        description: [
          '**Sécurité**',
          '• jeton d’appareil `vlt_…` hashé côté serveur et révocable ;',
          '• configuration locale `~/.valaria/code.json` en `0600` ;',
          '• écritures confinées au dossier du projet ;',
          '• approbation avant écriture/commande selon le mode.',
          '',
          '**Dépannage**',
          '`valaria login` ne trouve pas la page → vérifiez le réseau et l’URL du portail.',
          'Jeton expiré ou révoqué → `valaria logout` puis `valaria login`.',
          'Le diff est vide → projet sans changement Git, ou `/diff` pour actualiser.',
          'Trop d’approbations → `/2` ou `/3` en connaissance de cause.',
          '',
          'Ne publiez jamais votre jeton dans le Discord.',
        ].join('\n'),
      },
    ];
  }

  if (key === 'reports') {
    return [
      {
        title: 'Signaler un incident',
        description: [
          'Utilisez ce salon pour un incident de production, un abus ou une erreur de facturation.',
          '',
          '**Modèle de message**',
          '```\nDate et heure :\nEndpoint / client :\nModèle demandé :\nCode HTTP :\nMessage d’erreur :\nNom de compte (pas la clé) :\n```',
          '',
          'Ne publiez jamais de clé complète, de jeton `vlt_…` ou de secret.',
          'Le staff peut vous demander de révoquer la clé depuis **Réglages → Appareils connectés** ou **Mes clés API**.',
          '',
          `[Mon espace](${site}/portal) · [Site](${site})`,
        ].join('\n'),
      },
    ];
  }

  return [
    {
      title: 'VALARIA Gateway',
      description: `${siteLinks(site)}\n\nUtilisez \`#support\` pour toute question.`,
    },
  ];
}
