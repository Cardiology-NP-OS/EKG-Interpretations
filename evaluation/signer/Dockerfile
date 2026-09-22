ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /opt/ekg-evaluation-signer
COPY package.json ./package.json
COPY lib ./lib
COPY tools/sign_development_evaluation.js ./tools/sign_development_evaluation.js
COPY evaluation/keys ./evaluation/keys
COPY evaluation/registries ./evaluation/registries
COPY evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json ./evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json
COPY evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json ./evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json
