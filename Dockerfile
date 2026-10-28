FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
COPY web-proxy ./web-proxy
USER node
EXPOSE 3000
CMD ["npm", "start"]
