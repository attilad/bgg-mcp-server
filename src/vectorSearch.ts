// This file will integrate with a vector search library
// For now, it provides a simple implementation using categories and mechanics
// Later, this can be enhanced with actual vector embeddings

import * as db from './database.js';

/**
 * Calculate similarity score between two arrays
 * @param arr1 First array
 * @param arr2 Second array
 * @returns Similarity score between 0 and 1
 */
function calculateSimilarity(arr1: string[], arr2: string[]): number {
  if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) {
    return 0;
  }
  
  // Create sets for faster lookups
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  
  // Calculate intersection
  let intersection = 0;
  for (const item of set1) {
    if (set2.has(item)) {
      intersection++;
    }
  }
  
  // Calculate Jaccard similarity
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

/**
 * Find games similar to the given game ID
 * @param gameId ID of the reference game
 * @param limit Maximum number of games to return
 * @returns Array of similar games with similarity scores
 */
export async function findSimilarGames(gameId: number, limit = 10): Promise<any[]> {
  // Get the reference game
  const sourceGame = await db.getGame(gameId);
  if (!sourceGame) {
    return [];
  }
  
  // Get all other games
  const stmt = db.default.prepare('SELECT * FROM games WHERE id != ?');
  const allGames = stmt.all(gameId);
  
  // Calculate similarity for each game
  const scoredGames = allGames.map((game: any) => {
    // Make sure we parse the categories and mechanics if needed
    const gameCategories = game.categories ? 
      (typeof game.categories === 'string' ? JSON.parse(String(game.categories)) : game.categories) : 
      [];
      
    const gameMechanics = game.mechanics ? 
      (typeof game.mechanics === 'string' ? JSON.parse(String(game.mechanics)) : game.mechanics) : 
      [];
    
    // Calculate similarity based on categories and mechanics
    const categorySimilarity = calculateSimilarity(
      Array.isArray(sourceGame.categories) ? sourceGame.categories : [],
      gameCategories
    );
    
    const mechanicSimilarity = calculateSimilarity(
      Array.isArray(sourceGame.mechanics) ? sourceGame.mechanics : [],
      gameMechanics
    );
    
    // Overall similarity is a weighted average
    const similarity = (categorySimilarity * 0.6) + (mechanicSimilarity * 0.4);
    
    return {
      ...game,
      similarity: Math.round(similarity * 100) / 100  // Round to 2 decimal places
    };
  });
  
  // Sort by similarity and limit results
  return scoredGames
    .sort((a: any, b: any) => b.similarity - a.similarity)
    .slice(0, limit);
}

// Future enhancement: implement real vector search using embeddings
export async function generateGameVectors() {
  // This function would use an embedding model to generate vectors
  // For demonstration purposes, it's a placeholder
  console.log('Vector generation would happen here in a production implementation');
} 