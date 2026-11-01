# Certificats de test (uniquement pour les tests automatisés)

`server.crt` / `server.key` : certificat **auto-signé de test**, valable pour
`localhost` et `127.0.0.1`, utilisé par `test/https.test.js` pour vérifier
l'écouteur HTTPS natif de la passerelle.

⚠️ Cette clé privée est publique (versionnée) et ne doit servir qu'aux tests locaux.
Pour un usage réel, générez vos propres certificats avec `tools/generate-local-tls.ps1`.
