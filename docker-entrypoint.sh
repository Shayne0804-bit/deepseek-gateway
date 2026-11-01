#!/bin/sh
# Point d'entree du conteneur DeepSeek Gateway.
#
# Sur Railway (comme avec un volume Docker classique), le volume monte sur
# /data peut appartenir a root. On corrige les droits si on demarre en root,
# puis on execute l'application avec l'utilisateur non privilegie "node".
set -e

if [ "$(id -u)" = "0" ]; then
  data_dir="${DATA_DIR:-/data}"
  if [ -d "$data_dir" ]; then
    chown -R node:node "$data_dir" 2>/dev/null || true
  fi
  exec su-exec node "$@"
fi

exec "$@"
