// Using Node.js experimental SQLite module (requires --experimental-sqlite flag)
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get the directory name for the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure the data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Database file path
const dbPath = path.join(dataDir, 'bgg.sqlite');

// Initialize database
// Make sure to run Node with --experimental-sqlite flag
const db = new DatabaseSync(dbPath, {
  enableForeignKeyConstraints: true
});

// Database operations helpers

// No need for run/get/all/exec wrappers as Node.js SQLite is synchronous
export default db;

// Create tables if they don't exist
function initDatabase() {
  // Enable foreign keys - already enabled in constructor options
  
  // Games table for caching game details
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      year_published INTEGER,
      description TEXT,
      min_players INTEGER,
      max_players INTEGER,
      playing_time INTEGER,
      min_age INTEGER,
      thumbnail TEXT,
      image TEXT,
      categories TEXT, -- JSON array
      mechanics TEXT, -- JSON array
      designers TEXT, -- JSON array
      artists TEXT, -- JSON array
      publishers TEXT, -- JSON array
      stats TEXT, -- JSON object with ratings and ranks
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ttl INTEGER DEFAULT 604800 -- 7 days in seconds
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      last_synced TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User collections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_collections (
      username TEXT,
      game_id INTEGER,
      own INTEGER DEFAULT 0,
      played INTEGER DEFAULT 0,
      rating REAL,
      num_plays INTEGER DEFAULT 0,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (username, game_id),
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // Plays table for tracking game plays
  db.exec(`
    CREATE TABLE IF NOT EXISTS plays (
      id INTEGER PRIMARY KEY,
      username TEXT,
      game_id INTEGER,
      date TEXT,
      quantity INTEGER DEFAULT 1,
      comments TEXT,
      players TEXT, -- JSON array of player objects
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);

  // API request logs for rate limiting
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_requests (
      endpoint TEXT,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      params TEXT -- JSON representation of params
    )
  `);

  // Game vector data for similarity search
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_vectors (
      game_id INTEGER PRIMARY KEY,
      vector BLOB, -- Binary vector data
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  
  // Hot games table to store the current hot games
  db.exec(`
    CREATE TABLE IF NOT EXISTS hot_games (
      id INTEGER PRIMARY KEY,
      rank INTEGER,
      name TEXT NOT NULL,
      year_published INTEGER,
      thumbnail TEXT,
      last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_games_name ON games(name);
    CREATE INDEX IF NOT EXISTS idx_user_collections_username ON user_collections(username);
    CREATE INDEX IF NOT EXISTS idx_plays_username ON plays(username);
    CREATE INDEX IF NOT EXISTS idx_plays_game_id ON plays(game_id);
    CREATE INDEX IF NOT EXISTS idx_api_requests_endpoint ON api_requests(endpoint);
    CREATE INDEX IF NOT EXISTS idx_api_requests_timestamp ON api_requests(timestamp);
    CREATE INDEX IF NOT EXISTS idx_hot_games_rank ON hot_games(rank);
  `);
}

// Initialize the database
try {
  initDatabase();
} catch (err) {
  console.error('Error initializing database:', err);
}

// Database utility functions

// Game functions
export async function getGame(id: number) {
  try {
    const stmt = db.prepare('SELECT * FROM games WHERE id = ?');
    const game = stmt.get(id);
    
    if (game) {
      // Parse JSON fields
      game.categories = JSON.parse(String(game.categories || '[]'));
      game.mechanics = JSON.parse(String(game.mechanics || '[]'));
      game.designers = JSON.parse(String(game.designers || '[]'));
      game.artists = JSON.parse(String(game.artists || '[]'));
      game.publishers = JSON.parse(String(game.publishers || '[]'));
      game.stats = JSON.parse(String(game.stats || '{}'));
    }
    
    return game;
  } catch (error) {
    console.error('Error getting game:', error);
    return null;
  }
}

export async function saveGame(game: any) {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO games (
        id, name, type, year_published, description, min_players, max_players,
        playing_time, min_age, thumbnail, image, categories, mechanics,
        designers, artists, publishers, stats, last_updated
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
    `);
    
    stmt.run(
      game.id,
      game.name,
      game.type,
      game.yearPublished,
      game.description,
      game.minPlayers,
      game.maxPlayers,
      game.playingTime,
      game.minAge,
      game.thumbnail,
      game.image,
      JSON.stringify(game.categories || []),
      JSON.stringify(game.mechanics || []),
      JSON.stringify(game.designers || []),
      JSON.stringify(game.artists || []),
      JSON.stringify(game.publishers || []),
      JSON.stringify(game.statistics || {})
    );
    
    return game;
  } catch (error) {
    console.error('Error saving game:', error);
    return null;
  }
}

export async function searchGames(query: string) {
  try {
    const stmt = db.prepare(`
      SELECT * FROM games 
      WHERE name LIKE ? 
      ORDER BY name
      LIMIT 50
    `);
    
    const games = stmt.all(`%${query}%`);
    
    return games.map(game => {
      // Parse JSON fields
      game.categories = JSON.parse(String(game.categories || '[]'));
      game.mechanics = JSON.parse(String(game.mechanics || '[]'));
      game.designers = JSON.parse(String(game.designers || '[]'));
      game.artists = JSON.parse(String(game.artists || '[]'));
      game.publishers = JSON.parse(String(game.publishers || '[]'));
      game.stats = JSON.parse(String(game.stats || '{}'));
      return game;
    });
  } catch (error) {
    console.error('Error searching games:', error);
    return [];
  }
}

// Check if a game needs to be refreshed (older than TTL)
export async function gameNeedsRefresh(id: number): Promise<boolean> {
  try {
    const stmt = db.prepare(`
      SELECT id FROM games 
      WHERE id = ? AND (
        last_updated IS NULL OR 
        DATETIME(last_updated, '+' || ttl || ' seconds') < DATETIME('now')
      )
    `);
    
    const game = stmt.get(id);
    return !!game || !id; // If game doesn't exist or needs refresh
  } catch (error) {
    console.error('Error checking if game needs refresh:', error);
    return true; // Assume refresh needed on error
  }
}

export async function getUserCollection(username: string) {
  try {
    const stmt = db.prepare(`
      SELECT c.*, g.name FROM user_collections c
      JOIN games g ON c.game_id = g.id
      WHERE c.username = ?
      ORDER BY g.name
    `);
    
    return stmt.all(username);
  } catch (error) {
    console.error('Error getting user collection:', error);
    return [];
  }
}

export async function saveUserCollection(username: string, collection: any[]) {
  try {
    // Start a transaction
    db.exec('BEGIN TRANSACTION');
    
    // Insert or update user
    const userStmt = db.prepare(`
      INSERT OR REPLACE INTO users (username, last_synced)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    userStmt.run(username);
    
    // Insert or update collection items
    const collectionStmt = db.prepare(`
      INSERT OR REPLACE INTO user_collections (
        username, game_id, own, played, rating, num_plays, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const item of collection) {
      collectionStmt.run(
        username,
        item.id,
        item.own ? 1 : 0,
        item.played ? 1 : 0,
        item.rating,
        item.numPlays || 0
      );
    }
    
    // Commit transaction
    db.exec('COMMIT');
    
    return true;
  } catch (error) {
    // Rollback transaction on error
    db.exec('ROLLBACK');
    console.error('Error saving user collection:', error);
    return false;
  }
}

export async function getUserPlays(username: string, limit = 10) {
  try {
    const stmt = db.prepare(`
      SELECT p.*, g.name FROM plays p
      JOIN games g ON p.game_id = g.id
      WHERE p.username = ?
      ORDER BY p.date DESC
      LIMIT ?
    `);
    
    const plays = stmt.all(username, limit);
    
    return plays.map(play => {
      // Parse JSON fields
      play.players = JSON.parse(String(play.players || '[]'));
      return play;
    });
  } catch (error) {
    console.error('Error getting user plays:', error);
    return [];
  }
}

export async function savePlays(username: string, plays: any[]) {
  try {
    // Start a transaction
    db.exec('BEGIN TRANSACTION');
    
    // Insert or update user
    const userStmt = db.prepare(`
      INSERT OR REPLACE INTO users (username, last_synced)
      VALUES (?, CURRENT_TIMESTAMP)
    `);
    userStmt.run(username);
    
    // Insert or replace plays
    const playStmt = db.prepare(`
      INSERT OR REPLACE INTO plays (
        id, username, game_id, date, quantity, comments, players, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const play of plays) {
      playStmt.run(
        play.id,
        username,
        play.gameId,
        play.date,
        play.quantity || 1,
        play.comments,
        JSON.stringify(play.players || [])
      );
    }
    
    // Commit transaction
    db.exec('COMMIT');
    
    return true;
  } catch (error) {
    // Rollback transaction on error
    db.exec('ROLLBACK');
    console.error('Error saving plays:', error);
    return false;
  }
}

export async function logApiRequest(endpoint: string, params: any) {
  try {
    const stmt = db.prepare(`
      INSERT INTO api_requests (endpoint, params)
      VALUES (?, ?)
    `);
    
    stmt.run(endpoint, JSON.stringify(params));
    return true;
  } catch (error) {
    console.error('Error logging API request:', error);
    return false;
  }
}

export async function checkRateLimit(endpoint: string, windowSeconds = 60, maxRequests = 10): Promise<boolean> {
  try {
    const stmt = db.prepare(`
      SELECT COUNT(*) as count FROM api_requests
      WHERE endpoint = ? AND timestamp > datetime('now', '-' || ? || ' seconds')
    `);
    
    const result = stmt.get(endpoint, windowSeconds);
    if (!result) return true; // No results means no rate limiting
    
    return Number(result.count) < maxRequests;
  } catch (error) {
    console.error('Error checking rate limit:', error);
    return false; // Assume rate limited on error
  }
}

export async function saveGameVector(gameId: number, vector: Buffer) {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO game_vectors (game_id, vector)
      VALUES (?, ?)
    `);
    
    stmt.run(gameId, vector);
    return true;
  } catch (error) {
    console.error('Error saving game vector:', error);
    return false;
  }
}

export async function getGameVector(gameId: number) {
  try {
    const stmt = db.prepare(`
      SELECT vector FROM game_vectors
      WHERE game_id = ?
    `);
    
    const result = stmt.get(gameId);
    return result ? result.vector : null;
  } catch (error) {
    console.error('Error getting game vector:', error);
    return null;
  }
}

// Get hot games from database
export async function getHotGames() {
  try {
    const stmt = db.prepare(`
      SELECT * FROM hot_games 
      ORDER BY rank
      LIMIT 50
    `);
    
    const hotGames = stmt.all();
    return hotGames;
  } catch (error) {
    console.error('Error getting hot games:', error);
    return [];
  }
}

// Save hot games to database
export async function saveHotGames(hotGames: any[]) {
  try {
    // First clear existing hot games
    db.exec('DELETE FROM hot_games');
    
    // Insert new hot games
    const stmt = db.prepare(`
      INSERT INTO hot_games (
        id, rank, name, year_published, thumbnail, last_updated
      ) VALUES (
        ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      )
    `);
    
    for (const game of hotGames) {
      // Ensure all values are of proper types for SQLite
      const gameId = Number(game.id) || 0;
      const rank = Number(game.rank) || 0;
      const name = String(game.name || "Unknown");
      const yearPublished = game.yearPublished ? Number(game.yearPublished) : null;
      const thumbnail = game.thumbnail ? String(game.thumbnail) : null;
      
      // Log the values for debugging
      console.log(`Saving game: ID=${gameId}, Rank=${rank}, Name=${name}`);
      
      stmt.run(
        gameId,
        rank,
        name,
        yearPublished,
        thumbnail
      );
    }
    
    console.log(`Successfully synced ${hotGames.length} hot games`);
    return true;
  } catch (error) {
    console.error('Error saving hot games:', error);
    return false;
  }
}