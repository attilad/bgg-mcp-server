import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as db from './database.js';
import * as sync from './sync.js';
import * as vectorSearch from './vectorSearch.js';

// Type for the response that tools should return (matches MCP SDK expected format)
type ToolContent = {
  type: "text";
  text: string;
} | {
  type: "image";
  data: string;
  mimeType: string;
} | {
  type: "audio";
  data: string;
  mimeType: string;
} | {
  type: "resource";
  resource: {
    text: string;
    uri: string;
    mimeType?: string;
  } | {
    uri: string;
    blob: string;
    mimeType?: string;
  };
};

type ToolResponse = {
  content: ToolContent[];
  isError?: boolean;
  [key: string]: unknown;
};

// Register all tools with the MCP server
export function registerTools(server: McpServer) {
  // Search games (uses local database first, then falls back to API)
  server.tool("search-games", "Search for board games by name", {
    query: z.string().describe("The name of the game to search for"),
    exact: z.boolean().optional().describe("Whether to search for an exact match (default: false)"),
    useLocalOnly: z.boolean().optional().describe("Whether to only search locally without API fallback (default: false)"),
  }, async (args, extra) => {
    try {
      // First try to search the local database
      const localResults = await db.searchGames(args.query);
      
      // If we have results or useLocalOnly is true, return them
      if (localResults.length > 0 || args.useLocalOnly) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(localResults, null, 2),
            },
          ],
        };
      }
      
      // Otherwise, fall back to the BGG API
      // This will use the original implementation from index.js
      return {
        content: [
          {
            type: "text",
            text: "No local results found. Would fall back to BGG API in the original implementation.",
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error searching for games: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // Get game details (uses local database first, then falls back to API)
  server.tool("get-game-details", "Get detailed information about a specific board game", {
    id: z.number().describe("The BoardGameGeek ID of the game"),
    stats: z.boolean().optional().describe("Whether to include ranking and rating stats (default: false)"),
    forceRefresh: z.boolean().optional().describe("Whether to force a refresh from the BGG API (default: false)"),
  }, async (args, extra) => {
    try {
      // Check if we need to force a refresh or if the game needs refreshing
      if (args.forceRefresh || await db.gameNeedsRefresh(args.id)) {
        await sync.syncGameDetails(args.id);
      }
      
      // Try to get the game from the local database
      const game = await db.getGame(args.id);
      
      // If we have the game, return it
      if (game) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(game, null, 2),
            },
          ],
        };
      }
      
      // Otherwise, return an error
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Game with ID ${args.id} not found.`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error retrieving game details: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // Get user collection (uses local database first, then falls back to API)
  server.tool("get-user-collection", "Get a user's board game collection", {
    username: z.string().describe("The BoardGameGeek username"),
    owned: z.boolean().optional().describe("Filter to only show owned games (default: false)"),
    played: z.boolean().optional().describe("Filter to only show played games (default: false)"),
    rated: z.boolean().optional().describe("Filter to only show rated games (default: false)"),
    forceRefresh: z.boolean().optional().describe("Whether to force a refresh from the BGG API (default: false)"),
  }, async (args, extra) => {
    try {
      // Check if we need to force a refresh
      if (args.forceRefresh) {
        const success = await sync.syncUserCollection(args.username);
        if (!success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "queued",
                  message: "Collection request has been queued by BoardGameGeek. Please try again in a few moments.",
                  collection: []
                })
              },
            ],
          };
        }
      }
      
      // Get the collection from the local database
      let collection = await db.getUserCollection(args.username);
      
      // Apply filters if specified
      if (args.owned !== undefined) {
        collection = collection.filter((item: any) => item.own === (args.owned ? 1 : 0));
      }
      if (args.played !== undefined) {
        collection = collection.filter((item: any) => item.played === (args.played ? 1 : 0));
      }
      if (args.rated !== undefined) {
        collection = collection.filter((item: any) => args.rated ? item.rating !== null : true);
      }
      
      // If we have results, return them
      if (collection.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                collection
              })
            },
          ],
        };
      }
      
      // If no local results, try to sync from the API
      if (!args.forceRefresh) {
        const success = await sync.syncUserCollection(args.username);
        if (!success) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "queued",
                  message: "Collection request has been queued by BoardGameGeek. Please try again in a few moments.",
                  collection: []
                })
              },
            ],
          };
        }
        
        // Try to get the collection again after syncing
        collection = await db.getUserCollection(args.username);
        
        // Apply filters again
        if (args.owned !== undefined) {
          collection = collection.filter((item: any) => item.own === (args.owned ? 1 : 0));
        }
        if (args.played !== undefined) {
          collection = collection.filter((item: any) => item.played === (args.played ? 1 : 0));
        }
        if (args.rated !== undefined) {
          collection = collection.filter((item: any) => args.rated ? item.rating !== null : true);
        }
        
        if (collection.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "success",
                  collection
                })
              },
            ],
          };
        }
      }
      
      // If still no results, return an empty collection
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "success",
              message: `No games found in ${args.username}'s collection matching the specified filters.`,
              collection: []
            })
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "error",
              message: `Error retrieving user collection: ${error instanceof Error ? error.message : String(error)}`,
              collection: []
            })
          },
        ],
      };
    }
  });
  
  // Get user plays (uses local database first, then falls back to API)
  server.tool("get-user-plays", "Get a user's recent board game plays", {
    username: z.string().describe("The BoardGameGeek username"),
    maxPlays: z.number().optional().describe("Maximum number of plays to return (default: 10)"),
    forceRefresh: z.boolean().optional().describe("Whether to force a refresh from the BGG API (default: false)"),
  }, async (args, extra) => {
    try {
      // Check if we need to force a refresh
      if (args.forceRefresh) {
        await sync.syncUserPlays(args.username, args.maxPlays || 10);
      }
      
      // Get the plays from the local database
      let plays = await db.getUserPlays(args.username, args.maxPlays || 10);
      
      // If we have results, return them
      if (plays.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(plays, null, 2),
            },
          ],
        };
      }
      
      // If no local results, try to sync from the API
      if (!args.forceRefresh) {
        await sync.syncUserPlays(args.username, args.maxPlays || 10);
        
        // Try to get the plays again after syncing
        plays = await db.getUserPlays(args.username, args.maxPlays || 10);
        
        if (plays.length > 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(plays, null, 2),
              },
            ],
          };
        }
      }
      
      // If still no results, return an appropriate message
      return {
        content: [
          {
            type: "text",
            text: `No plays found for user ${args.username}.`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error retrieving user plays: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // Get hot games (uses local database first, then falls back to API)
  server.tool("get-hot-games", "Get the current hottest board games on BoardGameGeek", {
    forceRefresh: z.boolean().optional().describe("Whether to force a refresh from the BGG API (default: false)"),
  }, async (args, extra) => {
    try {
      // Always sync hot games since they change frequently
      await sync.syncHotGames();
      
      // Get the hot games from the database
      const hotGames = await db.getHotGames();
      
      // Return the actual hot games list, not just a confirmation
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(hotGames, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error retrieving hot games: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // NEW TOOL: Get similar games
  server.tool("get-similar-games", "Get games similar to a specified game", {
    id: z.number().describe("The BoardGameGeek ID of the reference game"),
    limit: z.number().optional().describe("Maximum number of similar games to return (default: 10)"),
  }, async (args, extra) => {
    try {
      // Get the game from the database
      const game = await db.getGame(args.id);
      
      if (!game) {
        // If the game isn't in the database, sync it
        const success = await sync.syncGameDetails(args.id);
        
        if (!success) {
          return {
            content: [
              {
                type: "text",
                text: `No game found with ID ${args.id}.`,
              },
            ],
          };
        }
      }
      
      // Find similar games
      const similarGames = await vectorSearch.findSimilarGames(args.id, args.limit || 10);
      
      // Return the results
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(similarGames, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error finding similar games: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // Sync user collection
  server.tool("sync-user-collection", "Synchronize a user's collection from BoardGameGeek", {
    username: z.string().describe("The BoardGameGeek username"),
  }, async (args, extra) => {
    try {
      const success = await sync.syncUserCollection(args.username);
      
      if (!success) {
        return {
          content: [
            {
              type: "text",
              text: "Collection request has been queued by BoardGameGeek. Please try again in a few moments.",
            },
          ],
        };
      }
      
      // Get the actual collection data after synchronization
      const collection = await db.getUserCollection(args.username);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(collection, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error synchronizing user collection: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
  
  // Sync user plays
  server.tool("sync-user-plays", "Synchronize a user's plays from BoardGameGeek", {
    username: z.string().describe("The BoardGameGeek username"),
    maxPlays: z.number().optional().describe("Maximum number of plays to sync (default: 100)"),
  }, async (args, extra) => {
    try {
      await sync.syncUserPlays(args.username, args.maxPlays || 100);
      
      // Get the actual plays data after synchronization
      const plays = await db.getUserPlays(args.username, args.maxPlays || 100);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(plays, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error synchronizing user plays: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }
  });
} 