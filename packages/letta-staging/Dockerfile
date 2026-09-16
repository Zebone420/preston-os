FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @letta-ai/letta-code@0.32.8 --omit=dev --ignore-scripts=false \
    && npm cache clean --force

WORKDIR /workspace
COPY start-letta.sh /usr/local/bin/start-preston-letta
RUN chmod 0755 /usr/local/bin/start-preston-letta \
    && mkdir -p /root/.letta /workspace

EXPOSE 4500
ENTRYPOINT ["/usr/local/bin/start-preston-letta"]
