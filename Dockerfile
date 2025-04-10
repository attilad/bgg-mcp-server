FROM node:22

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Build TypeScript files
RUN npm run build

# Make data directory persistent
VOLUME /app/data

# Redirect all console.log to console.error
ENTRYPOINT ["node", "--experimental-sqlite", "--require=./patchlogs.js", "build/index.js"]