# YouTube Live Chat Aggregator - Express Backend

A Node.js Express backend for aggregating live chat messages from multiple YouTube streams.

## 🚀 **Features**

- **Express.js** server with proper CORS configuration
- **Live Chat Fetching** from multiple YouTube streams simultaneously  
- **Video Metadata** extraction (title, views, likes, channel info)
- **Real-time Chat Polling** with continuation tokens
- **Message Caching** for improved performance
- **Professional Error Handling** with detailed logging

## 📦 **Installation**

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## 🔧 **Environment Variables**

```bash
# .env file (optional)
PORT=3001
NODE_ENV=production
```

## 🌐 **API Endpoints**

### GET `/`
Basic API status check

### GET `/debug`
Server debug information and memory usage

### POST `/api/live-chat`
Fetch live chat messages from YouTube videos

**Request Body:**
```json
{
  "urls": ["https://youtube.com/watch?v=VIDEO_ID"],
  "pageSize": 200,
  "after": "2024-01-01T00:00:00Z",
  "messageIds": ["msg1", "msg2"]
}
```

### POST `/api/video-metadata`
Get metadata for YouTube videos

**Request Body:**
```json
{
  "urls": ["https://youtube.com/watch?v=VIDEO_ID"]
}
```

## 🚀 **Deployment**

### Render.com
1. Connect your GitHub repository
2. Select "Web Service"
3. Use these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node.js

### Railway/Heroku
```bash
# Add engines to package.json (already included)
"engines": {
  "node": ">=18.0.0"
}
```

### Docker (Optional)
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
```

## 🔍 **CORS Configuration**

The server is configured to allow requests from:
- `https://chatsfusion.vercel.app`
- `http://localhost:3000`
- `http://localhost:3001`

To add more origins, update the `corsOptions` in `index.js`.

## 📝 **Logging**

The server provides detailed console logging with emojis for easy debugging:
- 🎥 Video processing
- ✅ Successful operations  
- ❌ Errors and failures
- 📦 Cache usage
- 💬 Chat message fetching

## 🛠 **Development**

```bash
# Watch mode for development
npm run dev

# Manual testing
curl -X POST http://localhost:3001/api/live-chat \
  -H "Content-Type: application/json" \
  -d '{"urls":["YOUTUBE_URL"]}'
```

## 📊 **Performance**

- **Caching:** 15-minute token cache, 5-minute message cache
- **Rate Limiting:** Built-in YouTube API respect
- **Memory Management:** Automatic cleanup on shutdown
- **Concurrent Requests:** Handles multiple video streams

## 🔒 **Security**

- CORS protection
- Input validation
- Error handling without data leaks
- No sensitive data in logs 