FROM node:18-bullseye-slim

# Install Chromium, Xvfb, and required libraries for Puppeteer & Turnstile bypass
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    apt-transport-https \
    chromium \
    chromium-driver \
    xvfb \
    fonts-liberation \
    libnss3 \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome Binary path env
ENV CHROME_BIN=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 7860

CMD ["node", "src/index.js"]
