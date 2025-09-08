# Stage 1: Build the frontend application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and yarn.lock to leverage Docker cache
COPY package.json yarn.lock ./

# Install git, which is required for some dependencies
RUN apk add --no-cache git

# Install dependencies, ignoring scripts to avoid running electron-specific postinstall steps
RUN yarn install --frozen-lockfile --ignore-scripts

# Copy the rest of the application source code
COPY . .

# Build the web application for production
RUN yarn pack:web

# Stage 2: Setup the backend and serve the application
FROM node:20-alpine

WORKDIR /app

# Copy backend package.json and yarn.lock to leverage Docker cache
COPY backend/package.json backend/yarn.lock ./backend/
RUN cd backend && yarn install --frozen-lockfile --production

# Copy the rest of the backend code
COPY backend/ ./backend/

# Copy the built frontend assets from the builder stage
COPY --from=builder /app/dist/web ./dist/web

# Expose the port the backend server is running on
EXPOSE 3000

# Start the backend server
CMD ["node", "backend/server.js"]
