# Stage 1: Build the application
FROM node:20-alpine AS builder

# Set the working directory
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

# Stage 2: Serve the application with Nginx
FROM nginx:stable-alpine

# Copy the built assets from the builder stage
COPY --from=builder /app/dist/web /usr/share/nginx/html

# Copy the nginx configuration file
# This file will be created in the next step.
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 for the web server
EXPOSE 80

# Start Nginx when the container launches
CMD ["nginx", "-g", "daemon off;"]
