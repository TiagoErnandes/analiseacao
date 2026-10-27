FROM node:22-alpine
WORKDIR /app
ENV TZ=America/Sao_Paulo NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# O serviço "web" usa este comando; o "agendador" usa o mesmo build com outro comando.
CMD ["npm", "start"]
