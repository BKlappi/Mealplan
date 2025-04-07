// Load environment variables from .env file
const fileUpload = require('express-fileupload');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');

const saltRounds = 10;
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const initializeDb = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL
      );
    `);
    console.log("Users table ready.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_goals (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        calories INTEGER,
        protein INTEGER
      );
    `);
    console.log("User goals table ready.");

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
    process.exit(1);
  } finally {
    client.release();
  }
};

initializeDb().catch(err => console.error("Database initialization failed:", err));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const mealPlannerModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const foodRecognitionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(fileUpload());
app.use(express.json());

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Username, email, and password are required.' });
  }
  try {
    const password_hash = await bcrypt.hash(password, saltRounds);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      [username, email, password_hash]
    );
    res.status(201).json({ success: true, userId: result.rows[0].id });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Username or email already exists.' });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }
  try {
    const result = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const token = jwt.sign({ userId: user.id, username: user.username, email: user.email }, jwtSecret, { expiresIn: '1h' });
    res.json({ success: true, username: user.username, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.get('/api/user/goals', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`SELECT calories, protein FROM user_goals WHERE user_id = $1`, [req.user.userId]);
    res.json({ success: true, goals: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error fetching goals.' });
  }
});

app.post('/api/user/goals', authenticateToken, async (req, res) => {
  const { calories, protein } = req.body;
  if (!calories || !protein) {
    return res.status(400).json({ success: false, message: 'Calories and protein are required.' });
  }
  try {
    await pool.query(`
      INSERT INTO user_goals (user_id, calories, protein)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET calories = EXCLUDED.calories, protein = EXCLUDED.protein
    `, [req.user.userId, calories, protein]);
    res.json({ success: true, message: 'Goals saved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error saving goals.' });
  }
});

app.get('/api/user/inventory', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, item_name, item_quantity FROM user_inventory WHERE user_id = $1 ORDER BY item_name`,
      [req.user.userId]
    );
    const inventory = result.rows.map(row => ({ id: row.id, name: row.item_name, quantity: row.item_quantity }));
    res.json({ success: true, inventory });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error fetching inventory.' });
  }
});

app.post('/api/user/inventory', authenticateToken, async (req, res) => {
  const { itemName, itemQuantity } = req.body;
  if (!itemName) {
    return res.status(400).json({ success: false, message: 'Item name is required.' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO user_inventory (user_id, item_name, item_quantity) VALUES ($1, $2, $3) RETURNING id, item_name, item_quantity`,
      [req.user.userId, itemName, itemQuantity || null]
    );
    const item = result.rows[0];
    res.status(201).json({ success: true, item: { id: item.id, name: item.item_name, quantity: item.item_quantity } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error adding item.' });
  }
});

app.delete('/api/user/inventory/:id', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.id);
  if (!itemId) return res.status(400).json({ success: false, message: 'Valid item ID required.' });
  try {
    const result = await pool.query(
      `DELETE FROM user_inventory WHERE id = $1 AND user_id = $2`,
      [itemId, req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Item not found.' });
    res.json({ success: true, message: 'Item deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error deleting item.' });
  }
});

app.put('/api/user/inventory/:id', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.id);
  const { itemName, itemQuantity } = req.body;
  if (!itemId || !itemName) {
    return res.status(400).json({ success: false, message: 'Valid item ID and name required.' });
  }
  try {
    const result = await pool.query(
      `UPDATE user_inventory SET item_name = $1, item_quantity = $2 WHERE id = $3 AND user_id = $4 RETURNING id, item_name, item_quantity`,
      [itemName, itemQuantity || null, itemId, req.user.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Item not found.' });
    const item = result.rows[0];
    res.json({ success: true, item: { id: item.id, name: item.item_name, quantity: item.item_quantity } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Database error updating item.' });
  }
});

app.post('/api/generate-plan', authenticateToken, async (req, res) => {
  const { mode, meal_type, goals, inventory_list, meal_calories, meal_protein } = req.body;
  if (!mode || !goals || !inventory_list) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  let prompt = '';
  let responseJsonStructure = '';

  const inventoryString = inventory_list.map(item => `${item.name}${item.quantity ? ` (${item.quantity})` : ''}`).join(', ') || 'no items provided';
  const dailyGoalString = `User's approximate daily goals: ${goals.calories || 'Not specified'} kcal, ${goals.protein || 'Not specified'}g protein.`;

  if (mode === 'meal') {
    const mealGoalString = `Target for this specific meal: ${meal_calories || 'any'} kcal, ${meal_protein || 'any'}g protein.`;

    prompt = `
You are a meal planning assistant.

Your task:
- Generate ONE specific, sensible, commonly known meal recipe.
- Use ONLY ingredients from this list: ${inventoryString}.
- Do NOT use all ingredients; select only what is necessary.
- Prioritize known, tasty meals (e.g., "Chicken Stir-fry", "Rice Bowl").
- ONLY if impossible, create a simple, logical combination as a fallback.
- Estimate calories and protein accurately.

Targets:
- Calories: ${meal_calories} ±100
- Protein: ${meal_protein}g ±15

Output:
- If a suitable meal is possible, respond in **exactly** this format:

Calories: [Calculated Calories]; Protein: [Calculated Protein]g
Meal Name: [Name of the meal, or a descriptive title if no standard name exists]
Recipe:
1. Step one...
2. Step two...
3. Step three...
(and so on)

- If impossible within tolerances, respond with:
Insufficient Inventory for the wanted Goals

No other text.
`;
  } else if (mode === 'daily') {
    responseJsonStructure = `{
      "breakfast": {...},
      "lunch": {...},
      "dinner": {...},
      "snack1": {...},
      "snack2": {...},
      "can_generate": true | false,
      "generation_notes": "Optional notes"
    }`;
    prompt = `
You are a helpful and creative meal planning assistant.
Generate a full day meal plan (breakfast, lunch, dinner, 2 snacks) using primarily these ingredients: ${inventoryString}.
Aim for daily goals: ${dailyGoalString}
Respond ONLY with JSON in this format:
\`\`\`json
${responseJsonStructure}
\`\`\`
If impossible, set "can_generate": false and explain why in "generation_notes".
`;
  } else {
    return res.status(400).json({ error: 'Invalid mode.' });
  }

  try {
    const generationConfig = {
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 2000,
    };
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    const result = await mealPlannerModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
      safetySettings,
    });

    const responseText = result.response.candidates[0].content.parts[0].text.trim();

    if (mode === 'meal') {
      if (responseText.startsWith("Calories:")) {
        const firstLineEnd = responseText.indexOf('\n');
        const nutritionLine = responseText.substring(0, firstLineEnd).trim();
        const recipeText = responseText.substring(firstLineEnd + 1).trim();

        const calMatch = nutritionLine.match(/Calories:\s*(\d+)/i);
        const proteinMatch = nutritionLine.match(/Protein:\s*(\d+)g/i);

        const estimated_calories = calMatch ? parseInt(calMatch[1]) : null;
        const estimated_protein = proteinMatch ? parseInt(proteinMatch[1]) : null;

        res.json({
          success: true,
          data: {
            can_generate: true,
            meal_name: "Generated Meal",
            estimated_calories,
            estimated_protein,
            recipe: recipeText
          }
        });
      } else if (responseText === "Insufficient Inventory for the wanted Goals") {
        res.json({
          success: false,
          message: "Insufficient Inventory for the wanted Goals"
        });
      } else {
        res.json({
          success: false,
          message: "Unexpected AI response format.",
          raw_data: responseText
        });
      }
    } else {
      const cleanedText = responseText.replace(/^```json\s*|```$/g, '').trim();
      try {
        const planJson = JSON.parse(cleanedText);
        res.json({ success: true, data: planJson });
      } catch {
        res.json({ success: false, message: "AI response was not valid JSON.", raw_data: responseText });
      }
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error generating plan.' });
  }
});

function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    }
  };
}

app.post('/api/user/inventory/image', authenticateToken, async (req, res) => {
  if (!req.files || !req.files.foodImage) {
    return res.status(400).json({ success: false, message: 'No image uploaded.' });
  }
  const foodImageFile = req.files.foodImage;
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimeTypes.includes(foodImageFile.mimetype)) {
    return res.status(400).json({ success: false, message: 'Invalid file type.' });
  }

  try {
    const imagePart = fileToGenerativePart(foodImageFile.data, foodImageFile.mimetype);
    const prompt = `
Identify ONLY edible food items in the image.
Return ONLY a JSON array of strings, e.g., ["Apples", "Milk Carton"].
If none, return [].
`;

    const generationConfig = {
      temperature: 0.4,
      topP: 0.8,
      topK: 40,
      maxOutputTokens: 1024,
    };
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    const result = await foodRecognitionModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
      generationConfig,
      safetySettings,
    });

    const responseText = result.response.candidates[0].content.parts[0].text.trim();
    const cleanedText = responseText.replace(/^```json\s*|```$/g, '').trim();
    let recognizedItems;
    try {
      recognizedItems = JSON.parse(cleanedText);
      if (!Array.isArray(recognizedItems)) throw new Error();
    } catch {
      recognizedItems = [];
    }
    res.json({ success: true, recognizedItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Error recognizing food items.' });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
