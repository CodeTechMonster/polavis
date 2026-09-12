FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
