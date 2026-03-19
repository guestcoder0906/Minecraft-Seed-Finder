# Use Node.js 20 image (Debian-based for better compatibility)
FROM node:20

# Create app directory
WORKDIR /app

# Copy package files first for efficient caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all files into the container
COPY . .

# Set environment variables for Hugging Face
# HF Spaces strictly require listening on port 7860
ENV PORT=7860
EXPOSE 7860

# Start the application
CMD ["npm", "start"]
