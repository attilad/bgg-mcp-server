import * as db from './database.js';
import { fetchBggXml } from './api.js';

// Sync a user's collection
export async function syncUserCollection(username: string): Promise<boolean> {
  try {
    console.log(`Syncing collection for user: ${username}`);
    
    // Fetch collection from BGG API
    const params = {
      username,
      stats: 1
    };
    
    const data = await fetchBggXml("collection", params) as any;
    
    // Check if we received a status code 202 (request queued)
    if (data._termsofuse && !data.items) {
      console.log(`Collection request for ${username} queued by BGG. Will retry later.`);
      return false;
    }
    
    // Check if we have results
    if (!data.items || !data.items.item || data.items.item.length === 0) {
      console.log(`No games found in ${username}'s collection.`);
      return true; // Successful sync, just empty
    }
    
    // Process the results
    const collectionItems = data.items.item.map((item: any) => {
      const collectionItem: any = {
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
        collectionItem.rating = item.stats.rating?._value || "Not Rated";
        collectionItem.average = item.stats.rating?.average?._value || "Unknown";
        collectionItem.bayesAverage = item.stats.rating?.bayesaverage?._value || "Unknown";
      }
      
      return collectionItem;
    });
    
    // Save collection to database
    await db.saveUserCollection(username, collectionItems);
    
    // Sync game details for each game in the collection
    for (const item of collectionItems) {
      if (await db.gameNeedsRefresh(item.id)) {
        await syncGameDetails(item.id);
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Successfully synced ${collectionItems.length} games for user ${username}`);
    return true;
  } catch (error) {
    console.error(`Error syncing collection for user ${username}:`, error);
    return false;
  }
}

// Sync game details
export async function syncGameDetails(gameId: number): Promise<boolean> {
  try {
    console.log(`Syncing details for game ID: ${gameId}`);
    
    // Fetch game details from BGG API
    const params = { 
      id: gameId,
      stats: 1
    };
    
    const data = await fetchBggXml("thing", params) as any;
    
    // Check if we have results
    if (!data.items || !data.items.item || data.items.item.length === 0) {
      console.log(`No game found with ID ${gameId}.`);
      return false;
    }
    
    const game = data.items.item[0];
    
    // Extract game information
    const gameInfo: any = {
      id: game._id,
      type: game._type,
      name: game.name?.find((n: any) => n._type === "primary")?._value || "Unknown",
      description: game.description || "No description available",
      yearPublished: game.yearpublished?._value || "Unknown",
      minPlayers: game.minplayers?._value || "Unknown",
      maxPlayers: game.maxplayers?._value || "Unknown",
      playingTime: game.playingtime?._value || "Unknown",
      minAge: game.minage?._value || "Unknown",
      thumbnail: game.thumbnail,
      image: game.image,
      categories: [] as string[],
      mechanics: [] as string[],
      designers: [] as string[],
      artists: [] as string[],
      publishers: [] as string[],
    };
    
    // Extract categories, mechanics, designers, etc.
    if (game.link) {
      game.link.forEach((link: any) => {
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
    
    // Include stats if available
    if (game.statistics) {
      gameInfo.statistics = {
        ratings: {
          average: game.statistics.ratings.average?._value || "Unknown",
          bayesAverage: game.statistics.ratings.bayesaverage?._value || "Unknown",
          numRatings: game.statistics.ratings.usersrated?._value || "Unknown",
        },
        ranks: [] as any[],
      };
      
      // Extract ranking information
      if (game.statistics.ratings.ranks?.rank) {
        game.statistics.ratings.ranks.rank.forEach((rank: any) => {
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
    
    // Save game to database
    await db.saveGame(gameInfo);
    
    console.log(`Successfully synced details for game ${gameInfo.name} (ID: ${gameId})`);
    return true;
  } catch (error) {
    console.error(`Error syncing game details for ID ${gameId}:`, error);
    return false;
  }
}

// Sync user plays
export async function syncUserPlays(username: string, maxPlays = 100): Promise<boolean> {
  try {
    console.log(`Syncing plays for user: ${username}`);
    
    // Fetch plays from BGG API
    const params = {
      username,
      subtype: "boardgame",
    };
    
    const data = await fetchBggXml("plays", params) as any;
    
    // Check if we have results
    if (!data.plays || !data.plays.play || data.plays.play.length === 0) {
      console.log(`No plays found for user ${username}.`);
      return true; // Successful sync, just empty
    }
    
    // Process and format the results, limited to maxPlays
    const plays = data.plays.play.slice(0, maxPlays).map((play: any) => ({
      id: play._id,
      date: play._date,
      quantity: play._quantity,
      gameId: play.item?._objectid,
      gameName: play.item?._name || "Unknown",
      comments: play.comments || null,
      players: play.players?.player ?
        play.players.player.map((player: any) => ({
          username: player._username || "Anonymous",
          name: player._name,
          score: player._score,
          win: player._win === "1",
        })) : [],
    }));
    
    // Save plays to database
    await db.savePlays(username, plays);
    
    // Sync game details for each game in the plays
    for (const play of plays) {
      if (await db.gameNeedsRefresh(play.gameId)) {
        await syncGameDetails(play.gameId);
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Successfully synced ${plays.length} plays for user ${username}`);
    return true;
  } catch (error) {
    console.error(`Error syncing plays for user ${username}:`, error);
    return false;
  }
}

// Sync hot games
export async function syncHotGames(): Promise<boolean> {
  try {
    console.log('Syncing hot games');
    
    // Fetch hot games from BGG API
    const data = await fetchBggXml("hot", { type: "boardgame" }) as any;
    
    // Check if we have results
    if (!data.items || !data.items.item || data.items.item.length === 0) {
      console.log('Failed to retrieve hot games list.');
      return false;
    }
    
    // Process the results
    const hotGames = data.items.item.map((item: any) => {
      return {
        id: item._id,
        rank: item._rank,
        name: item.name[0]?._value || "Unknown",
        yearPublished: item.yearpublished?._value || item.yearpublished || null,
        thumbnail: item.thumbnail?._value || null,
      };
    });
    
    // Save hot games to database
    const success = await db.saveHotGames(hotGames);
    
    // Sync game details for each hot game
    for (const game of hotGames) {
      if (await db.gameNeedsRefresh(game.id)) {
        await syncGameDetails(game.id);
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return success;
  } catch (error) {
    console.error('Error syncing hot games:', error);
    return false;
  }
} 