ARG LETTA_CODE_IMAGE=ghcr.io/letta-ai/letta-code:0.32.8
FROM ${LETTA_CODE_IMAGE}

USER root
WORKDIR /workspace
COPY start-letta.sh /usr/local/bin/start-preston-letta
RUN chmod 0755 /usr/local/bin/start-preston-letta \
    && mkdir -p /root/.letta /workspace

EXPOSE 4500
ENTRYPOINT ["/usr/local/bin/start-preston-letta"]
