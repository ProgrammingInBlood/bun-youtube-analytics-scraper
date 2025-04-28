# YouTube Chat Multi - Backend

This is the backend service for the YouTube Chat Multi application, built with Bun.js and Elysia.

## Prerequisites

- [Bun](https://bun.sh/) (1.0.0 or newer)
- Node.js 18+ (for frontend)

## Development

To start the backend in development mode:

```bash
# From the backend directory
bun run dev

# Or from the project root to run both frontend and backend
npm run dev:all
```

## Building

To build the backend:

```bash
# From the backend directory
bun run build
```

This will create optimized files in the `dist` directory.

To create a standalone binary:

```bash
bun run build:binary
```

This creates a standalone executable file named `server`.

## Production

To run the backend in production:

```bash
# From the backend directory, after building
bun run start

# Or run the standalone binary
./server
```

## API Endpoints

The backend provides several API endpoints:

- `/api/live-chat` - Fetch live chat messages from YouTube
- `/api/video-metadata` - Fetch metadata for YouTube videos
- `/api/channel-live-videos` - Fetch currently live videos from a YouTube channel

## Environment Variables

- `NODE_ENV` - Set to `production` for production mode
- `PORT` - (Optional) Port to run the server on, defaults to 3001

## Scripts

- `dev` - Start the development server with hot reloading
- `start` - Start the production server
- `build` - Build the backend for production
- `build:binary` - Create a standalone binary
- `cleanup` - Remove temporary files 