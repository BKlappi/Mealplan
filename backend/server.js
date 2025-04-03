// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Import pg Pool
const bcrypt = require('bcrypt'); // Import bcrypt for password hashing
// Import the OpenAI library
const { OpenAI } = require('openai');
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


// Initialize OpenAI client
// Ensure OPENAI_API_KEY is set in your .env file
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();
const port = process.env.PORT || 3001; // Use port 3001 or environment variable

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

    // Insert user into the database (PostgreSQL uses $1, $2, etc. for parameters)
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
        if (result.rowCount === 0) { // Check affected rows using rowCount
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


// --- Meal Generation Endpoint --- (Should this be protected too? Maybe later)
app.post('/api/generate-meal', async (req, res) => { // Make handler async
  console.log("Received request body:", req.body);
  const { meal_type, goals, inventory_list } = req.body;

  // Basic validation
  if (!meal_type || !goals || !inventory_list) {
    return res.status(400).json({ error: 'Missing required fields: meal_type, goals, inventory_list' });
  }
  if (!Array.isArray(inventory_list)) {
      return res.status(400).json({ error: 'inventory_list must be an array' });
  }

  // Construct the prompt for the AI
  const inventoryString = inventory_list.map(item => `${item.name}${item.quantity ? ` (${item.quantity})` : ''}`).join(', ') || 'nothing';
  const prompt = `
You are a helpful meal planning assistant. Your task is to suggest a single meal recipe based *strictly* on the ingredients provided.

**Constraints:**
1.  **Use ONLY ingredients from the provided inventory list.** Do not suggest meals requiring ingredients not on the list. If no suitable meal can be made, indicate that clearly.
2.  Suggest a meal appropriate for the requested meal type: **${meal_type}**.
3.  Consider the user's daily goals (approximate): **${goals.calories || 'any'} kcal** and **${goals.protein || 'any'}g protein** for the whole day, but focus primarily on using the available ingredients for this single meal suggestion.
4.  Provide the output ONLY in JSON format with the following structure:
    \`\`\`json
    {
      "meal_name": "Name of the suggested meal",
      "recipe_steps": [
        "Step 1...",
        "Step 2...",
        "..."
      ],
      "can_generate": true | false // Set to false if no meal could be generated from inventory
    }
    \`\`\`
5.  If you cannot generate a meal strictly using the provided ingredients, respond with JSON where "can_generate" is false and provide a brief explanation in "meal_name" (e.g., "Insufficient ingredients").

**Available Inventory:** ${inventoryString}

**Requested Meal Type:** ${meal_type}

Generate the JSON output now.
`;

  console.log("--- Sending Prompt to OpenAI ---");
  console.log(prompt);
  console.log("-----------------------------");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Or use "gpt-4" if preferred/available
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7, // Adjust creativity vs. predictability
      response_format: { type: "json_object" }, // Request JSON output if model supports it
    });

    console.log("--- Received Response from OpenAI ---");
    const rawResponse = completion.choices[0]?.message?.content;
    console.log(rawResponse);
    console.log("-----------------------------------");

    if (!rawResponse) {
        throw new Error("OpenAI response was empty.");
    }

    // Attempt to parse the JSON response from the AI
    let mealData;
    try {
        mealData = JSON.parse(rawResponse);
    } catch (parseError) {
        console.error("Failed to parse OpenAI JSON response:", parseError);
        // Attempt to extract JSON if it's embedded in markdown ```json ... ```
        const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch && jsonMatch[1]) {
            try {
                mealData = JSON.parse(jsonMatch[1]);
                console.log("Successfully extracted and parsed JSON from markdown.");
            } catch (nestedParseError) {
                console.error("Failed to parse extracted JSON:", nestedParseError);
                throw new Error("AI response was not valid JSON, even after extraction.");
            }
        } else {
            throw new Error("AI response was not valid JSON.");
        }
    }


    // Check if the AI indicated it could generate a meal
    if (mealData.can_generate === false) {
        console.log("AI indicated no meal could be generated.");
        // Send a specific structure back to frontend for this case
        return res.status(200).json({
            meal_name: mealData.meal_name || "Could not generate meal",
            recipe_steps: ["Please check your inventory or try a different meal type."],
            can_generate: false
        });
    }

    // Send the parsed meal data back to the frontend
    res.json({
        meal_name: mealData.meal_name || "Untitled Meal",
        recipe_steps: mealData.recipe_steps || ["No recipe provided."],
        can_generate: true
    });

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    res.status(500).json({ error: 'Failed to generate meal suggestion from AI.' });
  }
});

// === Server Start ===
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
