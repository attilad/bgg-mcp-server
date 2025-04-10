import axios from "axios";
import { XMLParser } from "fast-xml-parser";
import * as db from './database.js';

// Base URL for the BoardGameGeek API
export const BGG_API_BASE = "https://boardgamegeek.com/xmlapi2";

// Initialize the XML parser
export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "_",
  isArray: (name) => {
    // Force certain elements to always be arrays, even if there's only one
    const alwaysArrays = ['item', 'link', 'name', 'rank', 'poll', 'results', 'result'];
    return alwaysArrays.includes(name);
  }
});

// Rate limits for BGG API
const RATE_LIMIT_WINDOW = 60; // 60 seconds
const MAX_REQUESTS_PER_WINDOW = 10; // Max 10 requests per 60 seconds

// Queue for pending requests
const requestQueue: Array<{
  endpoint: string;
  params: any;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}> = [];

// Flag to indicate if the queue processor is running
let isProcessingQueue = false;

// Process the request queue
async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  try {
    const request = requestQueue.shift();
    if (!request) {
      isProcessingQueue = false;
      return;
    }
    
    // Check if we can make a request
    if (await db.checkRateLimit(request.endpoint, RATE_LIMIT_WINDOW, MAX_REQUESTS_PER_WINDOW)) {
      try {
        // Log the API request
        db.logApiRequest(request.endpoint, request.params);
        
        // Make the API request
        const data = await fetchBggXmlDirectly(request.endpoint, request.params);
        request.resolve(data);
      } catch (error) {
        request.reject(error);
      }
    } else {
      // Put the request back at the front of the queue and wait
      requestQueue.unshift(request);
      console.log(`Rate limit reached for ${request.endpoint}. Waiting...`);
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    }
  } finally {
    isProcessingQueue = false;
    
    // Process the next request if there are any
    if (requestQueue.length > 0) {
      setTimeout(processQueue, 1000); // Add a 1-second delay between requests
    }
  }
}

// Direct API call - bypasses queue and rate limiting
async function fetchBggXmlDirectly(endpoint: string, params: any) {
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
  } catch (error) {
    console.error("BGG API Error:", error);
    throw error;
  }
}

// Utility function to fetch and parse XML from BoardGameGeek API
// This version respects rate limits and uses a queue
export async function fetchBggXml(endpoint: string, params: any) {
  return new Promise((resolve, reject) => {
    // Add the request to the queue
    requestQueue.push({
      endpoint,
      params,
      resolve,
      reject
    });
    
    // Start processing the queue if it's not already running
    if (!isProcessingQueue) {
      processQueue();
    }
  });
} 