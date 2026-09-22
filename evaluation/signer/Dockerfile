ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/ekg-evaluation-signer
COPY package.json ./package.json
COPY lib ./lib
COPY tools/sign_development_evaluation.js ./tools/sign_development_evaluation.js
COPY evaluation/keys ./evaluation/keys
COPY evaluation/registries ./evaluation/registries
