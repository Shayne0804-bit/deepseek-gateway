# Audit qualité web — DeepSeek Gateway

**Date :** 2026-11-03 · **Version :** 2.1.0
**Périmètre :** trois surfaces — site public (`/`), console d'administration (`/admin`), espace
utilisateur (`/portal`), états connectés et non connectés.
**Méthode :** skills `frontend-design`, `web-quality-audit` et `accessibility` ; mesure HTTP +
rendu Chrome headless (1440×900) + contrôles de contraste/focus/cibles tactiles/reduced-motion.
Scripts : `tools/public-quality.mjs`, `tools/theme-evidence.mjs`.
**Rapports bruts :** `docs/quality-report.json`, `docs/theme/report.json`, `docs/theme/checks.json`.

## Synthèse

| Catégorie | État | Preuve principale |
|---|---|---|
| **Performance** | 🟢 Bonne | 3–5 requêtes/page, 3,5–17,4 Ko transférés (gzip), DCL 29–336 ms, CLS 0–0,042, 0 long task |
| **Accessibilité** | 🟢 Bonne | 46 couples texte/fond WCAG AA (0 échec), focus 6/6, 0 champ sans libellé, 0 lien/bouton sans nom, skip link |
| **SEO** | 🟡 Volontairement limité | titres + descriptions uniques, `lang=fr`, `robots noindex` et `robots.txt` `Disallow: /` (instance privée) |
| **Bonnes pratiques** | 🟢 Bonne | CSP, XFO, COOP, Permissions-Policy, `x-request-id`, 0 script inline, 0 dépendance tierce, 0 erreur console |
| **Navigation agentique** | 🟢 Bonne | actions et liens nommés, libellés de formulaire, 5/5 liens internes en 200, hiérarchie de titres par état |

## Mesures (Chrome headless, 1440×900, gzip actif)

| Surface | HTTP | Taille HTML | Requêtes | Transféré (ressources) | DCL | Load | CLS | Long tasks | Erreurs JS |
|---|---|---|---|---|---|---|---|---|---|
| Site public `/` | 200 | 6,8 Ko | 3 | 9,3 Ko | 176 ms | 400 ms | 0 | 0 | 0 |
| Console `/admin` (connexion) | 200 | 3,9 Ko | 3 | 17,4 Ko | 336 ms | 338 ms | 0 | 0 | 0 |
| Portail `/portal` (connexion) | 200 | 5,7 Ko | 4 | 5,8 Ko | 47 ms | 74 ms | 0 | 0 | 0 |
| Portail `/portal` (connecté) | 200 | 5,7 Ko | 5 | 3,6 Ko | 29 ms | 35 ms | 0,042 | 0 | 0 |

- CSS/JS/HTML servis **compressés gzip** (`content-encoding: gzip`, `vary: accept-encoding`) avec
  cache navigateur de 5 min pour les assets ; aucune ressource tierce, aucune police web, aucune image.
- Les mesures sont **lab** (réseau local + Chrome headless). Pas de données terrain CrUX :
  instance privée et `noindex` ; à re-mesurer après exposition publique.

## Accessibilité (WCAG 2.2 — contrôles automatisés et manuels)

- **Contraste** : 46 couples texte/fond (site public, portail, connexion et console) — **0 échec**
  au seuil AA (4,5:1 texte normal, 3:1 grand texte/UI).
- **Clavier** : parcours Tab sur la console — **6/6** arrêts avec anneau de focus visible.
- **Formulaires** : 100 % des champs avec libellé associé (site/portail/console).
- **Noms accessibles** : 0 lien vide, 0 bouton vide, boutons de copie `aria-label`.
- **Structure** : `lang="fr"`, un `h1` visible par état, landmarks `header`/`nav`/`main`/`footer`,
  skip link « Aller au contenu » sur les trois surfaces.
- **Mouvement** : `prefers-reduced-motion` désactive scanlines et transitions (vérifié).
- **Cibles tactiles** : 30 contrôles admin (min 27 px de haut) et 5 contrôles portail — 0 sous le seuil 24 px.
- **Responsive** : aucun débordement horizontal en 390×844 sur les 3 surfaces et les 5 vues admin.
- **Mobile** : navigation admin repliée sur deux lignes (plus de barre coupée), KPI admin en grille
  2×2, cartes de quota portail compactes (2 + 1 pleine largeur), formulaire de connexion portail
  affiché **après** son titre, footer aligné, menu public limité aux liens utiles.
- Limite connue : les vues alternatives masquées (`display:none`) contiennent chacune leur `h1`
  d'état ; elles sont exclues de l'arbre d'accessibilité, donc un seul `h1` est perçu à la fois.

## SEO

- Titre et méta-description uniques par page ; `html lang="fr"` ; viewport mobile.
- `noindex, nofollow` sur toutes les pages + `robots.txt` `Disallow: /` : choix assumé pour une
  passerelle privée qui ne doit pas être indexée. Canonical non nécessaire (aucun doublon exposé).
- Contenu public utile pour un humain (capacités, branchement, statut) mais pas d'objectif
  d'acquisition : pas de marketing artificiel ni de données inventées.

## Bonnes pratiques / sécurité web

- CSP restrictive (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`),
  `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`, `x-request-id`.
- **0 script inline**, **0 dépendance npm**, **0 requête tierce** : surface d'attaque réduite.
- HSTS émis dès que la requête est HTTPS (TLS natif ou Railway avec `TRUST_PROXY=1`).
- Aucune erreur console/JS sur les 3 surfaces ; aucune fuite de données d'administration dans le
  HTML public ou le portail.

## Findings et corrections

| # | Constat | Sévérité | Statut |
|---|---|---|---|
| 1 | Le « site » n'était qu'une console d'admin : aucun site public, aucun espace utilisateur. | High (produit) | ✅ Corrigé : 3 surfaces distinctes, portail par clé, séparation admin/utilisateur |
| 2 | Titres publics en majuscules (ton « crié », telles génériques). | Medium (design) | ✅ Corrigé : casse de phrase sur le public, console garde son langage terminal |
| 3 | Header mobile en 3 lignes avec navigation tronquée. | Medium (responsive) | ✅ Corrigé : marque + statut sur une ligne, nav scrollable, lien secondaire masqué |
| 4 | Portail : « restant : 0 » affiché pour une clé sans plafond. | Medium (contenu) | ✅ Corrigé : « aucun plafond configuré » |
| 5 | Statut de la passerelle figé sur « vérification… » dans le portail. | Low | ✅ Corrigé : rafraîchissement du statut toutes les 60 s |
| 6 | Page de connexion portail trop vide (grand blanc). | Low (design) | ✅ Corrigé : aperçu de ce que l'utilisateur verra + footer |
| 7 | Assets non compressés (~105 Ko CSS/JS transférés). | Medium (perf) | ✅ Corrigé : gzip + cache 5 min → 3,5–17,4 Ko/page |
| 8 | Pas de mesure qualité publiée pour les nouvelles surfaces. | — | ✅ Corrigé : ce rapport + `quality-report.json` + preuves de rendu |
| 9 | Mobile : navigation admin coupée hors écran, KPI très hauts, ordre formulaire/titre du portail instable. | Medium (responsive) | ✅ Corrigé : nav admin sur 2 lignes, KPI 2×2, cartes portail compactes, titre avant formulaire, zéro débordement |
| 10 | La console d'administration était annoncée en clair sur le site public et le portail (nav, CTA, footer). | Medium (exposition) | ✅ Corrigé : aucun lien ni mention admin sur les pages publiques ; accès uniquement par URL directe `/admin` (documenté dans le README, pas dans l'UI publique) |
| 11 | Section « Brancher un client » : le numéro d'étape était placé comme colonne de grille, le texte s'écrasait dans une colonne de ~40 px et la page débordait de 60 px en mobile. | High (contenu illisible) | ✅ Corrigé : numéro en position absolue, grille `minmax(0,1fr)`, code scrollable (retour à la ligne en mobile), captures dédiées 22/23 sous la ligne de flottaison |

## Risques résiduels et recommandations

1. **Pas de données terrain** (CrUX) : l'instance est privée ; rejouer Lighthouse/PSI après mise en
   ligne publique derrière HTTPS.
2. **Pas de MFA** pour l'admin (risque accepté, documenté dans `docs/SECURITY.md`) ; TOTP à envisager
   si l'exposition devient permanente.
3. **`noindex` volontaire** : si le site public doit être référencé un jour, retirer les balises et
   `robots.txt`, ajouter canonical/OG et une page de contact.
4. **Polices** : aucune police web chargée (monospace système) — bon pour la performance, rendu
   dépendant de l'OS ; vérifier sur Windows/macOS/Linux lors du prochain passage.
5. Rejouer **axe/Lighthouse** en CI quand ces outils seront disponibles, et conserver
   `theme-evidence` comme garde-fou de régression (contraste, focus, responsive, états).

## Vérifications

```powershell
node --test test                     # 68 tests (dont portail, gzip, sécurité)
node tools/theme-evidence.mjs        # 24 captures + contrôles a11y/responsive -> docs/theme/
node tools/public-quality.mjs        # mesures HTTP + rendu -> docs/quality-report.json
node "…/check-evidence.js" docs/theme/report.json   # gate frontend-design : OK
```
