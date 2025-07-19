import express from 'express';
import cors from 'cors';
import { getLiveChat } from './api/liveChat.js';
import { getVideoMetadata } from './api/videoMetadata.js';

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: [
    'https://chatsfusion.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Debug information about the current state
async function getDebugInfo() {
  return {
    status: 'Direct API implementation (no Puppeteer)',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    memory: process.memoryUsage(),
    platform: process.platform,
    nodeVersion: process.version
  };
}

// Routes
app.get('/', (req, res) => {
  res.send('YouTube Live Chat Aggregator API');
});

app.get('/debug', async (req, res) => {
  try {
    const debugInfo = await getDebugInfo();
    res.json({
      status: 'ok',
      message: 'Debug information',
      info: debugInfo
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get debug info',
      error: error.message
    });
  }
});

app.post('/reset', (req, res) => {
  res.json({
    status: 'ok',
    message: 'No browser to reset in direct API mode'
  });
});

app.post('/api/live-chat', async (req, res) => {
  try {
    const { urls, pageSize, after, messageIds } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length > 3) {
      return res.status(400).json({ 
        error: 'Please provide up to 3 valid YouTube live URLs' 
      });
    }

    const chatData = await getLiveChat({
      urls,
      pageSize,
      after,
      messageIds
    });
    
    res.json(chatData);
  } catch (error) {
    console.error('Error fetching live chat:', error);
    res.status(500).json({ 
      error: 'Failed to fetch live chat data',
      details: error.message 
    });
  }
});

app.post('/api/video-metadata', async (req, res) => {
  try {
    const { urls } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length > 3) {
      return res.status(400).json({ 
        error: 'Please provide up to 3 valid YouTube live URLs' 
      });
    }

    const metadataList = await getVideoMetadata(urls);
    res.json(metadataList);
  } catch (error) {
    console.error('Error fetching video metadata:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video metadata',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 YouTube Live Chat Aggregator API is running at http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Cleanup on server shutdown
let isShuttingDown = false;

async function cleanup() {
  // Prevent multiple cleanup attempts
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('Shutting down server and cleaning up resources...');
  
  // Set a timeout to force exit if cleanup takes too long
  const forceExitTimeout = setTimeout(() => {
    console.error('Forced exit after timeout - some resources may not have been properly cleaned up');
    process.exit(1);
  }, 10000); // Force exit after 10 seconds
  
  try {
    // Close the HTTP server gracefully
    if (server) {
      console.log('Closing HTTP server...');
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    
    console.log('Cleanup completed successfully');
    clearTimeout(forceExitTimeout);
    process.exit(0);
  } catch (err) {
    console.error('Error during cleanup:', err);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  cleanup();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  cleanup();
});

export default app; 