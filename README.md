# BoardGameGeek MCP Server

This is a Model Context Protocol (MCP) server that integrates with the BoardGameGeek XML API, allowing Claude to search for board games, retrieve game details, get user collections, and more.

## Features

This server provides the following tools:

1. **search-games**: Search for board games by name
2. **get-game-details**: Get detailed information about a specific board game
3. **get-user-collection**: Get a user's board game collection with filtering options
4. **get-hot-games**: Get the current hottest board games on BoardGameGeek
5. **get-user-plays**: Get a user's recent board game plays

## Building and Running

### To build the server:

```bash
# From the root directory of the MCP SDK
npm run build
```

### To run the server directly:

```bash
node dist/esm/servers/bgg/index.js
```

## Using with Claude for Desktop

1. Open your Claude for Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the server configuration:

```json
{
  "mcpServers": {
    "boardgamegeek": {
      "command": "node",
      "args": ["/path/to/bgg-mcp-server/build/index.js"]
    }
  }
}
```

3. Restart Claude for Desktop

## Example Questions

Once connected to Claude, you can ask questions like:

- "Find board games similar to Pandemic"
- "What are the top 10 hottest games on BoardGameGeek right now?"
- "Show me the details of Catan"
- "What games are in user 'TomVasel's collection?"
- "What games has user 'dice_tower' played recently?"
