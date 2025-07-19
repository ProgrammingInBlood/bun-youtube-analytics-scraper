import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { getLiveChat } from './api/liveChat';
import { getVideoMetadata } from './api/videoMetadata';

interface LiveChatRequestBody {
  urls: string[];
  pageSize?: number;
  after?: string;
  messageIds?: string[];
}

interface MetadataRequestBody {
  urls: string[];
}

interface ChannelRequestBody {
  channelUrl: string;
}

// Debug information about the current state
async function getDebugInfo() {
  return {
    status: 'Direct API implementation (no Puppeteer)',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    memory: process.memoryUsage()
  };
}

const app = new Elysia()
  .get('/', () => 'YouTube Live Chat Aggregator API')
  .get('/debug', async () => {
    const debugInfo = await getDebugInfo();
    return {
      status: 'ok',
      message: 'Debug information',
      info: debugInfo
    };
  })
  .post('/reset', async () => {
    return {
      status: 'ok',
      message: 'No browser to reset in direct API mode'
    };
  })
  .post('/api/live-chat', 
    async ({ body }: { body: LiveChatRequestBody }) => {
      const { urls, pageSize, after, messageIds } = body;
      
      if (!urls || !Array.isArray(urls) || urls.length > 3) {
        return { 
          error: 'Please provide up to 3 valid YouTube live URLs' 
        };
      }

      try {
        const chatData = await getLiveChat({
          urls,
          pageSize,
          after,
          messageIds
        });
        return chatData;
      } catch (error) {
        console.error('Error fetching live chat:', error);
        return { error: 'Failed to fetch live chat data' };
      }
    }, 
    {
      body: t.Object({
        urls: t.Array(t.String()),
        pageSize: t.Optional(t.Number()),
        after: t.Optional(t.String()),
        messageIds: t.Optional(t.Array(t.String()))
      })
    }
  )
  .post('/api/video-metadata', 
    async ({ body }: { body: MetadataRequestBody }) => {
      const { urls } = body;
      
      if (!urls || !Array.isArray(urls) || urls.length > 3) {
        return { 
          error: 'Please provide up to 3 valid YouTube live URLs' 
        };
      }

      try {
        const metadataList = await getVideoMetadata(urls);
        return metadataList;
      } catch (error) {
        console.error('Error fetching video metadata:', error);
        return { error: 'Failed to fetch video metadata' };
      }
    }, 
    {
      body: t.Object({
        urls: t.Array(t.String())
      })
    }
  )

  .listen(3001);

console.log(`🦊 YouTube Live Chat Aggregator API is running at ${app.server?.hostname}:${app.server?.port}`);

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
    if (app.server) {
      console.log('Closing HTTP server...');
      await new Promise<void>((resolve) => {
        if (!app.server) return resolve();
        // Use type assertion to access close method
        (app.server as any).close(() => resolve());
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

export type App = typeof app; 