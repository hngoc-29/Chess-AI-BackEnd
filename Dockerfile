# ---- Build stage ------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage ------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

# Hugging Face Spaces (Docker SDK) routes traffic to port 7860 by default.
# Override PORT at deploy time if you're running this somewhere else.
ENV PORT=7860
EXPOSE 7860

# Run as a non-root user for defense in depth.
RUN useradd --user-group --create-home --shell /bin/false appuser \
  && chown -R appuser:appuser /app
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||7860)+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
