// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Import pg Pool
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
// Import the Google Generative AI library
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const jwt = require('jsonwebtoken'); // Import jsonwebtoken

// --- Constants ---
const saltRounds = 10; // Cost factor for bcrypt hashing
const jwtSecret = process.env.JWT_SECRET; // Load JWT secret from .env
if (!jwtSecret) {
  // In a real app, you might want more robust error handling or a default secret for development
  console.error("FATAL ERROR: JWT_SECRET is not defined in .env file. Cannot proceed securely.");
  process.exit(1); // Exit if secret is missing - critical for security
}

// --- Database Setup (PostgreSQL) ---
// Render provides the DATABASE_URL environment variable
// For local development, you might need to set this in your .env file
// e.g., DATABASE_URL=postgresql://user:password@host:port/database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Use SSL in production on Render, but maybe not locally
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Function to initialize database schema
const initializeDb = async () => {
  const client = await pool.connect();
  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL
      );
    `);
    console.log("Users table ready.");

    // Create user_goals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_goals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        calories INTEGER,
        protein INTEGER
      );
    `);
    console.log("User goals table ready.");

    // Create user_inventory table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_inventory (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_name VARCHAR(255) NOT NULL,
        item_quantity VARCHAR(255)
      );
    `);
    console.log("User inventory table ready.");

  } catch (err) {
    console.error("Error initializing database schema:", err);
    // Consider exiting if schema creation fails critically
    process.exit(1);
  } finally {
    client.release(); // Release the client back to the pool
  }
};

// Call initialization function during startup
initializeDb().catch(err => console.error("Database initialization failed:", err));


// Initialize Google Generative AI client
// Ensure GOOGLE_API_KEY is set in your .env file
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file. Cannot proceed securely.");
  process.exit(1); // Exit if key is missing
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" }); // Or "gemini-pro" if 1.5 isn't needed/available

const app = express();
const port = 10000; // Use port 10000
console.log("Server listening on port:", port);

// === Middleware ===
// Enable CORS for all origins (adjust for production later if needed)
app.use(cors());
// Parse JSON request bodies
app.use(express.json());


// --- Authentication Middleware ---
const authenticateToken = (req, res, next) => {
  // Get token from the Authorization header (Bearer TOKEN)
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Extract token part

  if (token == null) {
    // No token provided
    console.log("Auth Middleware: No token provided");
    return res.sendStatus(401); // Unauthorized
  }

  // Verify the token
  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) {
      // Token is invalid or expired
      console.log("Auth Middleware: Invalid token", err.message);
      return res.sendStatus(403); // Forbidden
    }
    // Token is valid, attach user payload to the request object
    req.user = user; // Contains { userId, username, email, iat, exp }
    console.log("Auth Middleware: Token verified for user:", req.user.username);
    next(); // Proceed to the next middleware or route handler
  });
};


// === API Endpoints ===

// --- Registration Endpoint --- (Public - does not need authentication)
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Basic validation
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Username, email, and password are required.' });
  }

  try {
    // Hash the password
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert user into the database (PostgreSQL uses $1, $2, $3)
    // Use RETURNING id to get the new user's ID
    const sql = `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`;
    const values = [username, email, password_hash];

    const result = await pool.query(sql, values);
    const userId = result.rows[0].id;

    // Success
    console.log(`User registered successfully with ID: ${userId}`, { username, email });
    res.status(201).json({ success: true, message: 'User registered successfully.', userId: userId }); // 201 Created

  } catch (error) {
    // Check for unique constraint violation (PostgreSQL error code 23505)
    if (error.code === '23505') {
      console.error("Registration error: Duplicate username or email", { username, email });
      return res.status(409).json({ success: false, message: 'Username or email already exists.' }); // 409 Conflict
    }
    // Other errors (hashing or database)
    console.error("Error during registration:", error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// --- Login Endpoint ---
app.post('/api/login', async (req, res) => { // Add async
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const sql = `SELECT * FROM users WHERE email = $1`;
  try {
    const result = await pool.query(sql, [email]);
    const user = result.rows[0]; // pg returns rows array, get the first element

    if (!user) {
      // User not found
      console.log("Login attempt failed: User not found", { email });
      return res.status(401).json({ success: false, message: 'Invalid email or password.' }); // Unauthorized
    }

    // User found, compare password hash
    try {
      const match = await bcrypt.compare(password, user.password_hash);
      if (match) {
        // Passwords match - Generate JWT
        const payload = {
          userId: user.id, // Include user ID in the token payload
          username: user.username,
          email: user.email
        };
        // Sign the token - expires in 1 hour (adjust as needed)
        const token = jwt.sign(payload, jwtSecret, { expiresIn: '1h' });

        console.log("Login successful, token generated for:", { email, username: user.username });
        // Send back success, username, and token
        res.status(200).json({
          success: true,
          message: 'Login successful.',
          username: user.username,
          token: token // Send the generated token
        });
      } else {
        // Passwords don't match
        console.log("Login attempt failed: Incorrect password", { email });
        res.status(401).json({ success: false, message: 'Invalid email or password.' }); // Unauthorized
      }
    } catch (compareError) {
      console.error("Error comparing passwords:", compareError);
      res.status(500).json({ success: false, message: 'Server error during login.' });
    }
  } catch (dbError) {
      console.error("Database error during login:", dbError);
      return res.status(500).json({ success: false, message: 'Database error during login.' });
  }
});

// --- Protected User Data Endpoints ---

// GET User Goals
app.get('/api/user/goals', authenticateToken, async (req, res) => {
  const userId = req.user.userId; // Get user ID from verified token payload
  const sql = `SELECT calories, protein FROM user_goals WHERE user_id = $1`;

  try {
    const result = await pool.query(sql, [userId]);
    const goals = result.rows[0]; // Get the first row if it exists

    if (goals) {
      res.status(200).json({ success: true, goals: goals });
    } else {
      // No goals set yet for this user
      res.status(200).json({ success: true, goals: null });
    }
  } catch (err) {
    console.error("Database error getting goals:", err);
    return res.status(500).json({ success: false, message: 'Database error fetching goals.' });
  }
});

// SAVE User Goals (using INSERT OR REPLACE for simplicity)
app.post('/api/user/goals', authenticateToken, async (req, res) => { // Add async
  const userId = req.user.userId;
  const { calories, protein } = req.body;

  // Basic validation
  if (calories === undefined || protein === undefined || isNaN(parseInt(calories)) || isNaN(parseInt(protein)) || calories <= 0 || protein <= 0) {
    return res.status(400).json({ success: false, message: 'Valid positive numbers for calories and protein are required.' });
  }

  // Use INSERT ... ON CONFLICT (PostgreSQL equivalent of INSERT OR REPLACE for primary key)
  const sql = `
    INSERT INTO user_goals (user_id, calories, protein)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET calories = EXCLUDED.calories, protein = EXCLUDED.protein;
  `;
  const values = [userId, parseInt(calories), parseInt(protein)];

  try {
    await pool.query(sql, values);
    console.log(`Goals saved/updated for user ID: ${userId}`);
    res.status(200).json({ success: true, message: 'Goals saved successfully.' });
  } catch (err) {
    console.error("Database error saving goals:", err);
    return res.status(500).json({ success: false, message: 'Database error saving goals.' });
  }
});

// GET User Inventory
app.get('/api/user/inventory', authenticateToken, async (req, res) => { // Ensure async
  const userId = req.user.userId;
  const sql = `SELECT id, item_name, item_quantity FROM user_inventory WHERE user_id = $1 ORDER BY item_name`;

  try {
    const result = await pool.query(sql, [userId]);
    // Map results to match expected frontend structure
    const inventory = result.rows.map(row => ({ id: row.id, name: row.item_name, quantity: row.item_quantity }));
    res.status(200).json({ success: true, inventory: inventory });
  } catch (err) {
    console.error("Database error getting inventory:", err);
    return res.status(500).json({ success: false, message: 'Database error fetching inventory.' });
  }
});


// ADD User Inventory Item
app.post('/api/user/inventory', authenticateToken, async (req, res) => { // Add async
  const userId = req.user.userId;
  const { itemName, itemQuantity } = req.body; // Match frontend naming? Let's assume name/quantity for now

  if (!itemName) {
    return res.status(400).json({ success: false, message: 'Item name is required.' });
  }

  // Use RETURNING id, item_name, item_quantity to get the newly inserted row
  const sql = `INSERT INTO user_inventory (user_id, item_name, item_quantity) VALUES ($1, $2, $3) RETURNING id, item_name, item_quantity`;
  const values = [userId, itemName, itemQuantity || null]; // Store null if quantity is empty

  try {
    const result = await pool.query(sql, values);
    const newItem = result.rows[0];
    console.log(`Inventory item added for user ID: ${userId} with ID: ${newItem.id}`);
    // Return the newly created item
    res.status(201).json({
        success: true,
        message: 'Item added successfully.',
        // Map to expected frontend structure
        item: { id: newItem.id, name: newItem.item_name, quantity: newItem.item_quantity }
    });
  } catch (err) {
    console.error("Database error adding inventory item:", err);
    return res.status(500).json({ success: false, message: 'Database error adding item.' });
  }
});

// DELETE User Inventory Item
app.delete('/api/user/inventory/:id', authenticateToken, async (req, res) => { // Add async
    const userId = req.user.userId;
    const itemId = req.params.id;

    if (!itemId || isNaN(parseInt(itemId))) {
        return res.status(400).json({ success: false, message: 'Valid item ID is required.' });
    }

    // Ensure the item belongs to the logged-in user before deleting
    const sql = `DELETE FROM user_inventory WHERE id = $1 AND user_id = $2`;
    const values = [parseInt(itemId), userId];

    try {
        const result = await pool.query(sql, values);
        if (result.rowCount === 0) { // Check affected rows
            // No row was deleted - either item didn't exist or didn't belong to user
             console.log(`Attempt to delete non-existent or unauthorized item ID: ${itemId} for user ID: ${userId}`);
            return res.status(404).json({ success: false, message: 'Item not found or not authorized.' });
        }
        console.log(`Inventory item deleted for user ID: ${userId}, Item ID: ${itemId}`);
        res.status(200).json({ success: true, message: 'Item deleted successfully.' });
    } catch (err) {
        console.error("Database error deleting inventory item:", err);
        return res.status(500).json({ success: false, message: 'Database error deleting item.' });
    }
});

// UPDATE User Inventory Item
app.put('/api/user/inventory/:id', authenticateToken, async (req, res) => { // Add async
    const userId = req.user.userId;
    const itemId = req.params.id;
    const { itemName, itemQuantity } = req.body;

     if (!itemId || isNaN(parseInt(itemId))) {
        return res.status(400).json({ success: false, message: 'Valid item ID is required.' });
    }
     if (!itemName) {
        return res.status(400).json({ success: false, message: 'Item name is required.' });
    }

    // Ensure the item belongs to the logged-in user before updating
    // Use RETURNING to get the updated row data
    const sql = `
        UPDATE user_inventory
        SET item_name = $1, item_quantity = $2
        WHERE id = $3 AND user_id = $4
        RETURNING id, item_name, item_quantity
    `;
    const values = [itemName, itemQuantity || null, parseInt(itemId), userId];

    try {
        const result = await pool.query(sql, values);
        if (result.rowCount === 0) { // Check affected rows
            // No row was updated - either item didn't exist or didn't belong to user
             console.log(`Attempt to update non-existent or unauthorized item ID: ${itemId} for user ID: ${userId}`);
            return res.status(404).json({ success: false, message: 'Item not found or not authorized.' });
        }
        const updatedItem = result.rows[0];
        console.log(`Inventory item updated for user ID: ${userId}, Item ID: ${itemId}`);
        res.status(200).json({
            success: true,
            message: 'Item updated successfully.',
            // Map to expected frontend structure
            item: { id: updatedItem.id, name: updatedItem.item_name, quantity: updatedItem.item_quantity }
        });
    } catch (err) {
        console.error("Database error updating inventory item:", err);
        return res.status(500).json({ success: false, message: 'Database error updating item.' });
    }
});


// --- Meal Generation Endpoint (Revised for Modes) ---
app.post('/api/generate-meal', async (req, res) => {
    console.log("Received generation request body:", req.body);
    const {
        mode,
        meal_type,
        goals,
        inventory_list,
        meal_calories,
        meal_protein
    } = req.body;

    // Basic validation
    if (!mode || !goals || !inventory_list) {
        return res.status(400).json({ error: 'Missing required fields: mode, goals, inventory_list' });
    }
    if (mode === 'meal' && !meal_type) {
        return res.status(400).json({ error: 'Missing required field for meal mode: meal_type' });
    }
    if (!Array.isArray(inventory_list)) {
        return res.status(400).json({ error: 'inventory_list must be an array' });
    }

    const inventoryString = inventory_list.map(item => `${item.name}${item.quantity ? ` (${item.quantity})` : ''}`).join(', ') || 'no items provided';
    const dailyGoalString = `User's approximate daily goals: ${goals.calories || 'Not specified'} kcal, ${goals.protein || 'Not specified'}g protein.`;
    let prompt = "";
    let responseJsonStructure = "";

    // --- Construct Prompt based on Mode ---
    if (mode === 'meal') {
        const mealGoalString = `Target for this specific meal: ${meal_calories || 'any'} kcal, ${meal_protein || 'any'}g protein.`;
        responseJsonStructure = `{
            "meal_name": "Name of the suggested meal",
            "estimated_calories": <number | null>,
            "estimated_protein": <number | null>,
            "recipe_steps": [ "Step 1...", "Step 2...", "..." ],
            "can_generate": true | false
        }`;
        prompt = `
You are a helpful and creative meal planning assistant specializing in realistic and appealing recipes.
Your task is to suggest ONE single, sensible meal recipe based primarily on the ingredients provided.

**Task:** Generate a recipe for **${meal_type}**.

**Constraints & Guidelines:**
1.  **Prioritize Inventory:** Use ingredients from the 'Available Inventory' list. Do not use *all* items if not needed. Avoid meals requiring significant ingredients *not* listed. Distribute inventory usage logically across the day.
2.  **Realism & Palatability:** Suggest common or reasonably creative dishes. Avoid absurd combinations. If inventory is unsuitable, indicate inability to generate.
3.  **Specific Meal Goals:** Aim to meet the ${mealGoalString} AS CLOSELY AS POSSIBLE for this single meal. If achieving the exact targets isn't possible with a sensible recipe using the inventory, prioritize a sensible recipe and estimate its nutrition accurately. Clearly state if the targets couldn't be met precisely.
4.  **Detailed Recipe:** Provide clear, step-by-step instructions.
5.  **JSON Output ONLY:** Provide the output *strictly* in the following JSON format. Do not include any text outside the JSON structure.
    \`\`\`json
    ${responseJsonStructure}
    \`\`\`
6.  **If No Meal Possible:** Respond with JSON where "can_generate" is false and "meal_name" explains why (e.g., "Insufficient ingredients for a sensible ${meal_type} meeting goals"). Set estimates to null.

**Available Inventory:** ${inventoryString}
**Requested Meal Type:** ${meal_type}
**Target Meal Nutrition:** ${mealGoalString}
**Reference Daily Goals:** ${dailyGoalString}

Generate the JSON output now.
`;
    } else if (mode === 'daily') {
        responseJsonStructure = `{
            "breakfast": { "meal_name": "...", "estimated_calories": <num|null>, "estimated_protein": <num|null>, "recipe_steps": [...] },
            "lunch": { "meal_name": "...", "estimated_calories": <num|null>, "estimated_protein": <num|null>, "recipe_steps": [...] },
            "dinner": { "meal_name": "...", "estimated_calories": <num|null>, "estimated_protein": <num|null>, "recipe_steps": [...] },
            "snack1": { "meal_name": "...", "estimated_calories": <num|null>, "estimated_protein": <num|null>, "recipe_steps": [...] },
            "snack2": { "meal_name": "...", "estimated_calories": <num|null>, "estimated_protein": <num|null>, "recipe_steps": [...] },
            "can_generate": true | false,
            "generation_notes": "Optional notes, e.g., if goals couldn't be met exactly or inventory was limited."
        }`;
      prompt = `
You are a helpful and creative meal planning assistant specializing in realistic and appealing recipes.
Your task is to generate a FULL DAY meal plan (Breakfast, Lunch, Dinner, 2 Snacks) aiming to meet the user's daily nutritional goals, using primarily the ingredients provided.

**Task:** Generate a full day's meal plan (5 meals).

**Constraints & Guidelines:**
1.  **Prioritize Inventory:** Use ingredients from the 'Available Inventory' list. You do not need to use *all* items. Avoid meals requiring significant ingredients *not* listed. Distribute inventory usage logically across the day.
2.  **Daily Goals:** Aim for the *total* calories and protein across all 5 meals to be as close as possible to the ${dailyGoalString}.
3.  **Realism & Palatability:** Suggest common or reasonably creative dishes for each meal slot. Avoid absurd combinations.
4.  **Individual Meal Estimates:** For EACH of the 5 meals (breakfast, lunch, dinner, snack1, snack2), provide the meal name, estimated calories, estimated protein (grams), and detailed recipe steps.
5.  **JSON Output ONLY:** Provide the output *strictly* in the following JSON format. Do not include any text outside the JSON structure.
    \`\`\`json
    ${responseJsonStructure}
    \`\`\`
6.  **If No Full Plan Possible:** If the inventory is insufficient to create a sensible full-day plan meeting the approximate goals, respond with JSON where "can_generate" is false and add a note in "generation_notes" explaining why (e.g., "Insufficient inventory for a full day plan").

**Available Inventory:** ${inventoryString}
**Target Daily Goals:** ${dailyGoalString}

Generate the JSON output now.
`;
      } else {
          return res.status(400).json({ error: 'Invalid mode specified. Use "meal" or "daily".' });
      }


  console.log(`--- Sending Prompt to Google AI (Mode: ${mode}) ---`);
  console.log(prompt);
  console.log("-----------------------------");

  try {
    // Configuration for Gemini - Request JSON output and set safety settings
    const generationConfig = {
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 2000,
    };

    const safetySettings = [ // Adjust safety settings as needed
      {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
      {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
      {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
      {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE},
    ];

    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig,
      safetySettings,
    });

        if (!result || !result.candidates || result.candidates.length === 0) {
            console.error("Gemini failed to return a candidate.");
            return res.status(500).json({ error: 'Failed to generate meal plan. Gemini returned no result.' });
        }

    res.json({
      data: result.candidates[0].content.parts[0].text,
    });
  } catch (error) {
    console.error("Gemini error:", error);
    res.status(500).json({ error: 'Failed to generate meal plan' });
  }
});

app.listen(10000, () => {
  console.log(`Server listening on port 10000`);
});
