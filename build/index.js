import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
// Base URL for the BoardGameGeek API
const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";
// Initialize the XML parser
const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "_",
    isArray: (name) => {
        // Force certain elements to always be arrays, even if there's only one
        const alwaysArrays = ['item', 'link', 'name', 'rank', 'poll', 'results', 'result'];
        return alwaysArrays.includes(name);
    }
});
// Create the MCP server
const server = new McpServer({ name: "bgg-server", version: "1.0.0" }, { capabilities: { tools: {} } });
// Utility function to fetch and parse XML from BoardGameGeek API
async function fetchBggXml(endpoint, params) {
    try {
        // Build query string from params
        const queryParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            queryParams.append(key, String(value));
        });
        // Make the API request
        const url = `${BGG_API_BASE}/${endpoint}?${queryParams.toString()}`;
        console.error(`Fetching ${url}`);
        const response = await axios.get(url, {
            headers: {
                "Accept": "application/xml",
                "User-Agent": "MCP-BGG-Integration/1.0"
            }
        });
        // Parse the XML response
        const data = parser.parse(response.data);
        return data;
    }
    catch (error) {
        console.error("BGG API Error:", error);
        throw error;
    }
}
// Define a search tool to find games by name
server.tool("search-games", "Search for board games by name", {
    query: z.string().describe("The name of the game to search for"),
    exact: z.boolean().optional().describe("Whether to search for an exact match (default: false)"),
}, async ({ query, exact }) => {
    try {
        const searchParams = {
            query,
            type: "boardgame,boardgameexpansion",
        };
        if (exact) {
            searchParams.exact = 1;
        }
        const data = await fetchBggXml("search", searchParams);
        // Check if we have results
        if (!data.items || !data.items.item || data.items.item.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No games found matching "${query}".`,
                    },
                ],
            };
        }
        // Process and format the results
        const gameResults = data.items.item.map((item) => ({
            id: item._id,
            name: item.name?.[0]?._value || item.name?._value || "Unknown",
            yearPublished: item.yearpublished?._value || "Unknown",
            type: item._type || "Unknown",
        }));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(gameResults, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
// Define a tool to get detailed game information
server.tool("get-game-details", "Get detailed information about a specific board game", {
    id: z.number().describe("The BoardGameGeek ID of the game"),
    stats: z.boolean().optional().describe("Whether to include ranking and rating stats (default: false)"),
}, async ({ id, stats }) => {
    try {
        const params = { id };
        if (stats) {
            params.stats = 1;
        }
        const data = await fetchBggXml("thing", params);
        // Check if we have results
        if (!data.items || !data.items.item || data.items.item.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No game found with ID ${id}.`,
                    },
                ],
            };
        }
        const game = data.items.item[0];
        // Extract basic game information
        const gameInfo = {
            id: game._id,
            type: game._type,
            name: game.name?.find((n) => n._type === "primary")?._value || "Unknown",
            description: game.description || "No description available",
            yearPublished: game.yearpublished?._value || "Unknown",
            minPlayers: game.minplayers?._value || "Unknown",
            maxPlayers: game.maxplayers?._value || "Unknown",
            playingTime: game.playingtime?._value || "Unknown",
            minAge: game.minage?._value || "Unknown",
            categories: [],
            mechanics: [],
            designers: [],
            artists: [],
            publishers: [],
        };
        // Extract categories, mechanics, designers, etc.
        if (game.link) {
            game.link.forEach((link) => {
                if (link._type === "boardgamecategory") {
                    gameInfo.categories.push(link._value);
                }
                else if (link._type === "boardgamemechanic") {
                    gameInfo.mechanics.push(link._value);
                }
                else if (link._type === "boardgamedesigner") {
                    gameInfo.designers.push(link._value);
                }
                else if (link._type === "boardgameartist") {
                    gameInfo.artists.push(link._value);
                }
                else if (link._type === "boardgamepublisher") {
                    gameInfo.publishers.push(link._value);
                }
            });
        }
        // Include stats if requested
        if (stats && game.statistics) {
            gameInfo.statistics = {
                ratings: {
                    average: game.statistics.ratings.average?._value || "Unknown",
                    bayesAverage: game.statistics.ratings.bayesaverage?._value || "Unknown",
                    numRatings: game.statistics.ratings.usersrated?._value || "Unknown",
                },
                ranks: [],
            };
            // Extract ranking information
            if (game.statistics.ratings.ranks?.rank) {
                game.statistics.ratings.ranks.rank.forEach((rank) => {
                    if (rank._type && rank._value) {
                        gameInfo.statistics.ranks.push({
                            type: rank._type,
                            name: rank._name,
                            value: rank._value,
                        });
                    }
                });
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(gameInfo, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
// Define a tool to get a user's collection
server.tool("get-user-collection", "Get a user's board game collection", {
    username: z.string().describe("The BoardGameGeek username"),
    owned: z.boolean().optional().describe("Filter to only show owned games (default: false)"),
    played: z.boolean().optional().describe("Filter to only show played games (default: false)"),
    rated: z.boolean().optional().describe("Filter to only show rated games (default: false)"),
}, async ({ username, owned, played, rated }) => {
    try {
        const params = {
            username,
            stats: 1, // Always include stats for more useful information
        };
        // Add filters if specified
        if (owned !== undefined) {
            params.own = owned ? 1 : 0;
        }
        if (played !== undefined) {
            params.played = played ? 1 : 0;
        }
        if (rated !== undefined) {
            params.rated = rated ? 1 : 0;
        }
        const data = await fetchBggXml("collection", params);
        // Check if we received a status code 202 (request queued)
        if (data._termsofuse && !data.items) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Collection request has been queued by BoardGameGeek. Please try again in a few moments.",
                    },
                ],
            };
        }
        // Check if we have results
        if (!data.items || !data.items.item || data.items.item.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No games found in ${username}'s collection matching the specified filters.`,
                    },
                ],
            };
        }
        // Process and format the results
        const collectionItems = data.items.item.map((item) => {
            const collectionItem = {
                id: item._objectid,
                name: item.name?._text || item.name || "Unknown",
                yearPublished: item.yearpublished || "Unknown",
                image: item.image || null,
                status: {
                    own: item.status?._own === "1",
                    played: item.status?._played === "1",
                    rated: item.rating && item.rating > 0,
                    numPlays: item.numplays || 0,
                },
            };
            // Add statistics if available
            if (item.stats) {
                collectionItem.stats = {
                    rating: item.stats.rating?._value || "Not Rated",
                    average: item.stats.rating?.average?._value || "Unknown",
                    bayesAverage: item.stats.rating?.bayesaverage?._value || "Unknown",
                };
            }
            return collectionItem;
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(collectionItems, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            isError: true,
            content: [
                {
                    type: "text",
                    text: `Error retrieving user collection: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
});
// Define a tool to get hot games
server.tool("get-hot-games", "Get the current hottest board games on BoardGameGeek", {}, async () => {
    try {
        const data = await fetchBggXml("hot", { type: "boardgame" });
        // Check if we have results
        if (!data.items || !data.items.item || data.items.item.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to retrieve hot games list.",
                    },
                ],
            };
        }
        // Process and format the results
        const hotGames = data.items.item.map((item) => ({
            id: item._id,
            rank: item._rank,
            name: item.name?._value || "Unknown",
            yearPublished: item.yearpublished?._value || "Unknown",
            thumbnail: item.thumbnail?._value || null,
        }));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(hotGames, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
// Define a tool to get a user's game plays
server.tool("get-user-plays", "Get a user's recent board game plays", {
    username: z.string().describe("The BoardGameGeek username"),
    maxPlays: z.number().optional().describe("Maximum number of plays to return (default: 10)"),
}, async ({ username, maxPlays = 10 }) => {
    try {
        const params = {
            username,
            subtype: "boardgame",
        };
        const data = await fetchBggXml("plays", params);
        // Check if we have results
        if (!data.plays || !data.plays.play || data.plays.play.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No plays found for user ${username}.`,
                    },
                ],
            };
        }
        // Process and format the results, limited to maxPlays
        const plays = data.plays.play.slice(0, maxPlays).map((play) => ({
            id: play._id,
            date: play._date,
            quantity: play._quantity,
            gameId: play.item?._objectid,
            gameName: play.item?._name || "Unknown",
            comments: play.comments || null,
            players: play.players?.player ?
                play.players.player.map((player) => ({
                    username: player._username || "Anonymous",
                    name: player._name,
                    score: player._score,
                    win: player._win === "1",
                })) : [],
        }));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(plays, null, 2),
                },
            ],
        };
    }
    catch (error) {
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
// Run the server
async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("BoardGameGeek MCP Server running on stdio");
    }
    catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}
main();
