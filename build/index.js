import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from './tools.js';
// Create the MCP server
const server = new McpServer({ name: "bgg-server", version: "1.0.0" }, { capabilities: { tools: {} } });
// IMPORTANT: We now use the enhanced tools in tools.js instead of these original implementations
// Register all the enhanced tools from tools.js
registerTools(server);
// Run the server
async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("BoardGameGeek MCP Server running on stdio with SQLite persistence enabled");
    }
    catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}
main();
