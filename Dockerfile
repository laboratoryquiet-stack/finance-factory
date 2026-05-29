# Use the official Node.js image
FROM node:18-slim
# Add this line right after the FROM node line
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application
COPY . .

# Start the application
CMD [ "node", "server.js" ]
