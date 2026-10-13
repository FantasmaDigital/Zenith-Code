FROM node:20-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY .npmrc ./
COPY package*.json ./

RUN npm install --allow-git=all --omit=dev

COPY . .

RUN mkdir -p auth_info_baileys

EXPOSE 3000

CMD ["node", "src/index.js"]
