FROM node:22-bookworm

# Runtime libraries for the prebuilt @napi-rs/canvas binary used by PDF OCR.
# Tesseract itself is not installed; tesseract.js runs WebAssembly in Node.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libpixman-1-0 \
    libfontconfig1 \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 3000

CMD ["npm", "run", "dev"]
