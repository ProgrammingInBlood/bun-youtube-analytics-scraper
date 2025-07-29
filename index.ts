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

export default new Elysia()
  .use(cors())
  .get('/', () => 'YouTube Live Chat Aggregator API')
  .get('/debug', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    memory: process.memoryUsage()
  }))
  .post('/api/live-chat', 
    async ({ body }: { body: LiveChatRequestBody }) => {
      const { urls, pageSize, after, messageIds } = body;
      
      if (!urls || !Array.isArray(urls) || urls.length > 3) {
        return { 
          error: 'Please provide up to 3 valid YouTube live URLs' 
        };
      }

      try {
        return await getLiveChat({ urls, pageSize, after, messageIds });
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
        return await getVideoMetadata(urls);
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
  .listen(3000);

console.log(`🦊 YouTube Live Chat Aggregator API is running`);
