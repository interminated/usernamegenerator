# Explicitly start only our Node.js web server; no automatic HTTP wrapper.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "server.js"]
