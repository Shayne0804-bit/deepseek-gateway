# Image de production pour DeepSeek Gateway.
# Compatible Docker local, docker compose et Railway (PaaS).
#
# NB : volontairement AUCUNE instruction VOLUME ici. Railway refuse les volumes
# declares dans le Dockerfile : sur Railway, le volume se configure dans le
# tableau de bord et se monte sur /data (voir README > Deployer sur Railway).
FROM node:24-alpine

# su-exec permet de demarrer en root (pour corriger les droits du volume),
# puis d'executer l'application avec l'utilisateur non privilegie "node".
RUN apk add --no-cache su-exec

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/data

COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

# Railway fournit la variable PORT ; en local l'application ecoute sur 8787.
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
