FROM node:18-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy app source
COPY . .

# Cloud Run requires listening on PORT
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
