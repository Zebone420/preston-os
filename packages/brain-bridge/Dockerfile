FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
ENV PRESTON_BRAIN_BRIDGE_HOST=0.0.0.0

RUN chown -R node:node /app
USER node

EXPOSE 8787
CMD ["npm", "start"]
