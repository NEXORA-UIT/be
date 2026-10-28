FROM postgres:17-alpine

ARG PGVECTOR_VERSION=0.8.7

RUN apk add --no-cache --virtual .pgvector-build-deps build-base clang21 git llvm21-dev \
    && git clone --depth 1 --branch "v${PGVECTOR_VERSION}" \
        https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && make -C /tmp/pgvector \
    && make -C /tmp/pgvector install \
    && rm -rf /tmp/pgvector \
    && apk del .pgvector-build-deps
