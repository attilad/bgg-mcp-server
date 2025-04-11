// test-direct.js
import { spawn } from 'child_process';
import readline from 'readline';

async function main() {
  console.log("Starting direct MCP server test...");
  
  // Start the MCP server process
  const serverProcess = spawn('node', ['--experimental-sqlite', 'build/index.js'], {
    stdio: ['pipe', 'pipe', 'inherit'] // stdin, stdout, stderr
  });
  
  // Set up readline interface for reading server responses
  const rl = readline.createInterface({
    input: serverProcess.stdout,
    terminal: false
  });
  
  // Create a promise-based message handler
  function waitForResponse(requestId) {
    return new Promise((resolve) => {
      const messageHandler = (line) => {
        try {
          const response = JSON.parse(line);
          if (response.id === requestId) {
            rl.removeListener('line', messageHandler);
            resolve(response);
          }
        } catch (err) {
          // Not valid JSON or not our response yet
        }
      };
      
      rl.on('line', messageHandler);
    });
  }
  
  // Send a JSON-RPC request
  function sendRequest(method, params = {}) {
    const requestId = Date.now();
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };
    
    serverProcess.stdin.write(JSON.stringify(request) + '\n');
    return waitForResponse(requestId);
  }
  
  async function testCollection(username) {
    const response = await sendRequest('tools/call', {
      name: 'get-user-collection',
      arguments: {
        username: username,
        forceRefresh: true
      }
    });

    if (!response.result?.content?.[0]?.text) {
      return {
        status: 'error',
        message: 'No response received from server'
      };
    }

    try {
      return JSON.parse(response.result.content[0].text);
    } catch (error) {
      console.error("Error parsing collection response:", error);
      console.log("Raw response:", response.result.content[0].text);
      return {
        status: 'error',
        message: 'Failed to parse server response'
      };
    }
  }
  
  try {
    // Initialize the connection
    console.log("Initializing connection...");
    const initResponse = await sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    });
    console.log("Connected to server:", initResponse.result.serverInfo.name);
    
    // Test get-hot-games
    console.log("\nTesting get-hot-games...");
    const hotGamesResponse = await sendRequest('tools/call', {
      name: 'get-hot-games',
      arguments: {}
    });
    
    if (hotGamesResponse.result?.content?.[0]?.text) {
      try {
        const hotGames = JSON.parse(hotGamesResponse.result.content[0].text);
        console.log(`Retrieved ${hotGames.length} hot games:`);
        
        // Display first 5 games
        hotGames.slice(0, 5).forEach((game, index) => {
          console.log(`${index + 1}. ${game.name} (${game.year_published || game.yearPublished || 'N/A'}) - Rank: ${game.rank}`);
        });
      } catch (parseError) {
        console.error("Error parsing hot games response:", parseError);
        console.log("Raw response:", hotGamesResponse.result.content[0].text);
      }
    } else {
      console.log("No valid hot games data received");
      console.log("Response:", JSON.stringify(hotGamesResponse, null, 2));
    }

    // Test get-user-collection
    console.log("\nTesting get-user-collection for Phrozen_Pharaoh...");
    const collectionResult = await testCollection("Phrozen_Pharaoh");
    console.log(`Status: ${collectionResult.status}`);
    if (collectionResult.message) {
      console.log(`Message: ${collectionResult.message}`);
    }
    if (collectionResult.collection && collectionResult.collection.length > 0) {
      console.log(`Retrieved ${collectionResult.collection.length} games in collection:`);
      collectionResult.collection.slice(0, 5).forEach((game, i) => {
        console.log(`${i + 1}. ${game.name}`);
      });
    } else {
      console.log("No games found in collection");
    }
    
  } catch (error) {
    console.error("Error during test:", error);
  } finally {
    // Clean up
    rl.close();
    serverProcess.kill();
    console.log("Test completed");
  }
}

main().catch(console.error);