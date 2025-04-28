import { extractYouTubeTokens, fetchVideoMetadata, isValidYouTubeUrl, extractVideoId } from '../utils/directTokenExtractor';

// Cache for channel names to avoid repeated scraping
const channelNameCache: Record<string, { name: string, timestamp: number }> = {};
// Cache expiration time (24 hours)
const CHANNEL_CACHE_EXPIRATION = 24 * 60 * 60 * 1000;

interface VideoMetadata {
  videoId: string;
  videoUrl: string;
  title?: string;
  viewCount: number;
  likeCount: number;
  isLive: boolean;
  channelName?: string;
  error?: string;
}

// Helper function to extract channel name from HTML anchor or other formats
function extractChannelNameFromHTML(html: string): string | null {
  // Pattern for <a> tag with channel info
  const anchorPattern = /<a[^>]*href="\/(@[^"]+)"[^>]*>([^<]+)<\/a>/;
  const match = html.match(anchorPattern);
  
  if (match && match[2]) {
    return match[2].trim();
  }
  
  return null;
}

/**
 * Extracts metadata from the YouTube API response
 */
function parseMetadata(data: any, videoUrl: string, videoId: string, source: string = 'primary', extractedChannelName: string | null = null): VideoMetadata {
  try {
    // Default values if parsing fails
    const metadata: VideoMetadata = {
      videoId,
      videoUrl,
      viewCount: 0,
      likeCount: 0,
      isLive: false
    };

    // Check if we have a cached channel name for this video ID
    if (channelNameCache[videoId] && Date.now() - channelNameCache[videoId].timestamp < CHANNEL_CACHE_EXPIRATION) {
      metadata.channelName = channelNameCache[videoId].name;
      console.log(`Using cached channel name for ${videoId}: ${metadata.channelName}`);
    } 
    // Use channel name extracted from HTML if available
    else if (extractedChannelName) {
      metadata.channelName = extractedChannelName;
      console.log(`Using channel name from HTML: ${extractedChannelName}`);
      
      // Cache the channel name
      channelNameCache[videoId] = {
        name: extractedChannelName,
        timestamp: Date.now()
      };
    }

    // Log received data for debugging
    console.log(`Parsing metadata for ${videoId} from source: ${source}`);
    console.log(`Data structure keys:`, Object.keys(data || {}));

    // Handle data from primary source (updated_metadata endpoint)
    if (source === 'primary' && data?.actions) {
      console.log(`Found ${data.actions.length} actions in primary source`);
      
      // Loop through all actions to find what we need
      for (const action of data.actions) {
        // Extract view count - try multiple paths
        if (action.updateViewershipAction?.viewCount?.videoViewCountRenderer) {
          const renderer = action.updateViewershipAction.viewCount.videoViewCountRenderer;
          console.log('Found viewership action:', JSON.stringify(renderer));
          
          // Extract view count from simple text or runs
          let viewCountText = '';
          if (renderer.viewCount?.simpleText) {
            viewCountText = renderer.viewCount.simpleText;
          } else if (renderer.viewCount?.runs?.[0]?.text) {
            viewCountText = renderer.viewCount.runs[0].text;
          }
          
          // Parse the number from text like "1,234 watching"
          if (viewCountText) {
            const viewCount = parseInt(viewCountText.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(viewCount)) {
              metadata.viewCount = viewCount;
              console.log(`Extracted view count: ${viewCount} from "${viewCountText}"`);
            }
          }
          
          // Check if video is live
          metadata.isLive = !!renderer.isLive;
        }
        
        // Extract like count
        if (action.updateToggleButtonAction?.toggledButtons?.[0]?.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label) {
          const likeText = action.updateToggleButtonAction.toggledButtons[0].toggleButtonRenderer.defaultText.accessibility.accessibilityData.label;
          console.log('Found like button data:', likeText);
          
          // Extract number from text like "1,234 likes"
          const match = likeText.match(/([0-9,]+)/);
          if (match) {
            const likeCount = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(likeCount)) {
              metadata.likeCount = likeCount;
              console.log(`Extracted like count: ${likeCount} from "${likeText}"`);
            }
          }
        }
        
        // Try alternative like count path
        if (action.updateButtonAction?.button?.toggleButtonRenderer?.defaultText?.simpleText) {
          const likeText = action.updateButtonAction.button.toggleButtonRenderer.defaultText.simpleText;
          console.log('Found alternative like button data:', likeText);
          
          const match = likeText.match(/([0-9,]+)/);
          if (match) {
            const likeCount = parseInt(match[1].replace(/,/g, ''), 10);
            if (!isNaN(likeCount)) {
              metadata.likeCount = likeCount;
              console.log(`Extracted like count: ${likeCount} from "${likeText}"`);
            }
          }
        }
        
        // Extract title if available
        if (action.updateTitleAction?.title) {
          metadata.title = action.updateTitleAction.title;
          console.log(`Extracted title: ${metadata.title}`);
        }
        
        // Extract channel name if available
        if (action.updateChannelNavigationEndpointAction?.channelEndpoint?.channelInfo) {
          const channelInfo = action.updateChannelNavigationEndpointAction.channelEndpoint.channelInfo;
          if (channelInfo.title) {
            metadata.channelName = channelInfo.title;
            console.log(`Extracted channel name: ${metadata.channelName}`);
            
            // Cache the channel name
            channelNameCache[videoId] = {
              name: channelInfo.title,
              timestamp: Date.now()
            };
          }
        }
      }
    } 
    // Handle data from backup source (next endpoint)
    else if (source === 'backup' && data?.contents) {
      console.log('Processing backup source data');
      
      // Extract view count and other metadata from video primary info
      const videoInfo = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find((x: any) => 
        x.videoPrimaryInfoRenderer
      )?.videoPrimaryInfoRenderer;
      
      if (videoInfo) {
        console.log('Found videoPrimaryInfoRenderer in backup source');
        
        // Extract title
        if (videoInfo.title?.runs?.[0]?.text) {
          metadata.title = videoInfo.title.runs[0].text;
          console.log(`Extracted title: ${metadata.title}`);
        }
        
        // Extract channel name
        if (videoInfo.owner?.videoOwnerRenderer?.title?.runs) {
          const channelName = videoInfo.owner.videoOwnerRenderer.title.runs
            .map((run: any) => run.text || '')
            .join('');
          
          if (channelName) {
            metadata.channelName = channelName;
            console.log(`Extracted channel name from backup source: ${channelName}`);
            
            // Cache the channel name
            channelNameCache[videoId] = {
              name: channelName,
              timestamp: Date.now()
            };
          }
        }
        
        // Extract view count
        if (videoInfo.viewCount?.videoViewCountRenderer) {
          const renderer = videoInfo.viewCount.videoViewCountRenderer;
          
          // Check if the video is live
          metadata.isLive = !!renderer.isLive;
          
          // Extract view count text
          let viewCountText = '';
          if (renderer.viewCount?.simpleText) {
            viewCountText = renderer.viewCount.simpleText;
          } else if (renderer.viewCount?.runs?.[0]?.text) {
            viewCountText = renderer.viewCount.runs[0].text;
          }
          
          if (viewCountText) {
            const viewCount = parseInt(viewCountText.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(viewCount)) {
              metadata.viewCount = viewCount;
              console.log(`Extracted view count: ${viewCount} from "${viewCountText}"`);
            }
          }
        }
        
        // Extract like count
        if (videoInfo.videoActions?.menuRenderer?.topLevelButtons) {
          const buttons = videoInfo.videoActions.menuRenderer.topLevelButtons;
          const likeButton = buttons.find((b: any) => b.toggleButtonRenderer?.defaultIcon?.iconType === "LIKE");
          
          if (likeButton?.toggleButtonRenderer?.defaultText?.accessibility?.accessibilityData?.label) {
            const likeText = likeButton.toggleButtonRenderer.defaultText.accessibility.accessibilityData.label;
            console.log('Found like button data in backup source:', likeText);
            
            const match = likeText.match(/([0-9,]+)/);
            if (match) {
              const likeCount = parseInt(match[1].replace(/,/g, ''), 10);
              if (!isNaN(likeCount)) {
                metadata.likeCount = likeCount;
                console.log(`Extracted like count: ${likeCount} from "${likeText}"`);
              }
            }
          } 
          else if (likeButton?.toggleButtonRenderer?.defaultText?.simpleText) {
            const likeText = likeButton.toggleButtonRenderer.defaultText.simpleText;
            console.log('Found simple like button data in backup source:', likeText);
            
            const match = likeText.match(/([0-9,]+)/);
            if (match) {
              const likeCount = parseInt(match[1].replace(/,/g, ''), 10);
              if (!isNaN(likeCount)) {
                metadata.likeCount = likeCount;
                console.log(`Extracted like count: ${likeCount} from "${likeText}"`);
              }
            }
          }
        }
      }
      
      // If still no metadata, try video secondary info
      if (metadata.viewCount === 0 || metadata.likeCount === 0) {
        const secondaryInfo = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find((x: any) => 
          x.videoSecondaryInfoRenderer
        )?.videoSecondaryInfoRenderer;
        
        if (secondaryInfo) {
          console.log('Found videoSecondaryInfoRenderer in backup source');
          // Try to extract additional metadata from secondary info
          // (YouTube sometimes puts view count here)
        }
      }
    } else {
      console.log('No actions or contents found in metadata response');
    }

    // If we still couldn't find metadata, try some alternative paths
    if (metadata.viewCount === 0 && data?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer) {
      const renderer = data.videoPrimaryInfoRenderer.viewCount.videoViewCountRenderer;
      let viewCountText = '';
      
      if (renderer.viewCount?.simpleText) {
        viewCountText = renderer.viewCount.simpleText;
      } else if (renderer.viewCount?.runs?.[0]?.text) {
        viewCountText = renderer.viewCount.runs[0].text;
      }
      
      if (viewCountText) {
        const viewCount = parseInt(viewCountText.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(viewCount)) {
          metadata.viewCount = viewCount;
          console.log(`Used alternative path to extract view count: ${viewCount}`);
        }
      }
      
      metadata.isLive = !!renderer.isLive;
    }

    // Check for likes in frameworkUpdates - newest YouTube API format
    if (metadata.likeCount === 0 && data?.frameworkUpdates?.entityBatchUpdate?.mutations) {
      console.log('Looking for like count in frameworkUpdates.entityBatchUpdate.mutations');
      
      for (const mutation of data.frameworkUpdates.entityBatchUpdate.mutations) {
        if (mutation.payload?.likeCountEntity) {
          const likeCountEntity = mutation.payload.likeCountEntity;
          console.log('Found likeCountEntity:', JSON.stringify(likeCountEntity));
          
          // Try several possible paths where the like count might be
          let likeCount = 0;
          
          // First try the most precise number if available
          if (likeCountEntity.likeCountIfIndifferentNumber) {
            likeCount = parseInt(likeCountEntity.likeCountIfIndifferentNumber, 10);
            console.log(`Extracted like count from likeCountIfIndifferentNumber: ${likeCount}`);
          } 
          // Then try the expanded string format with commas
          else if (likeCountEntity.expandedLikeCountIfIndifferent?.content) {
            const expanded = likeCountEntity.expandedLikeCountIfIndifferent.content;
            likeCount = parseInt(expanded.replace(/[^0-9]/g, ''), 10);
            console.log(`Extracted like count from expandedLikeCountIfIndifferent: ${likeCount}`);
          }
          // Finally try the abbreviated format (like "19K")
          else if (likeCountEntity.likeCountIfIndifferent?.content) {
            const abbreviated = likeCountEntity.likeCountIfIndifferent.content;
            console.log(`Found abbreviated like count: ${abbreviated}`);
            
            // Convert abbreviated format like "19K" to approximate number
            if (/\d+K/.test(abbreviated)) {
              const base = parseInt(abbreviated.replace(/[^0-9]/g, ''), 10);
              likeCount = base * 1000;
              console.log(`Converted abbreviated ${abbreviated} to approximate: ${likeCount}`);
            } else {
              likeCount = parseInt(abbreviated.replace(/[^0-9]/g, ''), 10);
            }
          }
          
          if (likeCount > 0 && !isNaN(likeCount)) {
            metadata.likeCount = likeCount;
            console.log(`Updated like count to: ${likeCount}`);
            break; // Found what we needed
          }
        }
      }
    }

    // Log the final metadata
    console.log(`Final metadata for ${videoId}:`, metadata);
    return metadata;
  } catch (error) {
    console.error('Error parsing metadata:', error);
    return {
      videoId,
      videoUrl,
      viewCount: 0,
      likeCount: 0,
      isLive: false,
      error: 'Failed to parse metadata'
    };
  }
}

/**
 * Fetches metadata for multiple YouTube video URLs
 */
export async function getVideoMetadata(urls: string[]): Promise<{ metadata: VideoMetadata[], errors: string[] }> {
  const validUrls = urls.filter(url => isValidYouTubeUrl(url));
  const errors: string[] = [];
  
  if (validUrls.length === 0) {
    errors.push('No valid YouTube URLs provided');
    return { metadata: [], errors };
  }

  // Process each URL in parallel
  const metadataPromises = validUrls.map(async (url) => {
    try {
      const videoId = extractVideoId(url) || 'unknown';
      
      // Extract required tokens for YouTube API
      const tokens = await extractYouTubeTokens(url);
      
      // Fetch video metadata - returns primary and backup data
      const result = await fetchVideoMetadata(url, tokens);
      
      // Try to extract channel name from HTML if available
      const extractedChannelName = extractChannelNameFromHTML(tokens.rawHtml);
      
      // Parse primary data first
      const metadata = parseMetadata(result.primary, url, videoId, 'primary', extractedChannelName);
      
      // If missing key info, try backup data
      if (!metadata.title || metadata.viewCount === 0) {
        const backupMetadata = parseMetadata(result.backup, url, videoId, 'backup', extractedChannelName);
        
        // Merge data, preferring primary where available
        if (!metadata.title && backupMetadata.title) {
          metadata.title = backupMetadata.title;
        }
        
        if (metadata.viewCount === 0 && backupMetadata.viewCount > 0) {
          metadata.viewCount = backupMetadata.viewCount;
        }
        
        if (metadata.likeCount === 0 && backupMetadata.likeCount > 0) {
          metadata.likeCount = backupMetadata.likeCount;
        }
        
        if (!metadata.channelName && backupMetadata.channelName) {
          metadata.channelName = backupMetadata.channelName;
        }
        
        if (!metadata.isLive && backupMetadata.isLive) {
          metadata.isLive = backupMetadata.isLive;
        }
      }
      
      return metadata;
    } catch (error) {
      console.error(`Error processing ${url}:`, error);
      
      // Return error metadata
      const videoId = extractVideoId(url) || 'unknown';
      errors.push(`Failed to fetch metadata from ${url}: ${error}`);
      
      return {
        videoId,
        videoUrl: url,
        viewCount: 0,
        likeCount: 0,
        isLive: false,
        error: `Failed to fetch: ${error}`
      };
    }
  });

  // Wait for all promises to resolve
  const metadataResults = await Promise.all(metadataPromises);

  return {
    metadata: metadataResults,
    errors
  };
}