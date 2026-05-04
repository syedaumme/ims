FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# This command checks if index.js is in the root or /src/
CMD ["sh", "-c", "if [ -f ./index.js ]; then node index.js; else node src/index.js; fi"]
EXPOSE 4000