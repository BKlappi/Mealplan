// Load environment variables from .env file
const fileUpload = require('express-fileupload');
require('dotenv').config();

const express = require('express');
const cors = require('cors');
// Removed: const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js'); // Added for Supabase
const bcrypt = require('bcrypt');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Added for API calls
const solver = require('javascript-lp-solver'); // For ingredient optimization

const saltRounds = 10;
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("FATAL ERROR: JWT_SECRET is not defined in .env file.");
  process.exit(1);
}

// Load USDA API Key
const USDA_API_KEY = process.env.USDA_API_KEY;
if (!USDA_API_KEY) {
  console.error("FATAL ERROR: USDA_API_KEY is not defined in .env file.");
  process.exit(1);
}

// --- Constants ---
const PORTION_LIMITS = {
  // Max grams per single serving (examples, adjust as needed)
  MAX_GRAIN_UNCOOKED_G: 150,
  MAX_MEAT_COOKED_G: 250, // Assuming input might be cooked weight for some items
  MAX_MEAT_UNCOOKED_G: 200, // More typical uncooked limit
  MAX_OATS_UNCOOKED_G: 100,
  MAX_SINGLE_VEGETABLE_G: 300, // e.g., large potato, broccoli head
  MAX_LEAFY_GREENS_G: 150,
  MAX_LIQUID_ML: 500, // e.g., milk, broth
  MAX_CHEESE_G: 50,
  MAX_NUTS_SEEDS_G: 40,
  MAX_FRUIT_PIECES: 2, // e.g., 2 apples
  MAX_EGGS_PCS: 3,
};
// Nutrient IDs from USDA FoodData Central (common ones)
const NUTRIENT_IDS = {
  CALORIES: 1008, // Energy (kcal) - FDC standard
  PROTEIN: 1003, // Protein - FDC standard
  FAT: 1004, // Total lipid (fat)
  CARBS: 1005, // Carbohydrate, by difference
  SUGAR: 2000, // Sugars, total including NLEA
  FIBER: 1079, // Fiber, total dietary
};

// --- Supabase Client Setup ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY; // Use service role key for backend

if (!supabaseUrl || !supabaseKey) {
  console.error("FATAL ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be defined in .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Optional: configure auth settings if needed, but service key bypasses RLS
    // autoRefreshToken: false,
    // persistSession: false
  }
});
console.log("Supabase client initialized.");

// Removed initializeDb function and call - Schema managed in Supabase dashboard

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("FATAL ERROR: GOOGLE_API_KEY is not defined in .env file.");
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const mealPlannerModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
const foodRecognitionModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Piece-to-gram conversion for common foods.
 * Used to convert 'pcs' to grams for nutrient calculation.
 * Add more mappings as needed for your inventory.
 */
const PIECE_TO_GRAM_MAP = {
  "egg": 50,
  "eggs": 50,
  "sausage": 60,
  "sausages": 60,
  "oreo": 11,
  "oreos": 11,
  "cheddar cheese": 20,
  "broccoli": 150,
  "brocolie": 150,
  "oreo cookie": 11,
  "oreo cookies": 11,
  "chicken breast": 120, // average per piece
  "red beans": 50, // per piece (approx, adjust as needed)
  // Add more as needed
};

/**
 * Default portion (in grams) for common foods if quantity/unit is missing.
 * Used to "assume just enough" for a single serving.
 */
const DEFAULT_PORTION_MAP = {
  "egg": 50,
  "eggs": 50,
  "sausage": 60,
  "sausages": 60,
  "oreo": 11,
  "oreos": 11,
  "cheddar cheese": 20,
  "broccoli": 100,
  "brocolie": 100,
  "oreo cookie": 11,
  "oreo cookies": 11,
  "chicken breast": 120,
  "red beans": 100,
  "rice": 150,
  "flour": 50,
  "milk": 200,
  "olive oil": 10,
  "sugar": 10,
  "potatoes": 150,
  "cheese": 30,
  "bread": 50,
  "cucumber": 100,
  "chillie flakes": 2,
  "curry pulver": 2,
  "backing pulver": 10,
  // Add more as needed
};
const DEFAULT_PORTION_GRAMS = 100; // fallback if not in map

/**
 * Ingredient categories and roles for filtering and template matching.
 * Extend as needed for your inventory.
 */
const INGREDIENT_CATEGORIES = {
  "egg": { category: "protein", role: "main" },
  "eggs": { category: "protein", role: "main" },
  "chicken breast": { category: "protein", role: "main" },
  "sausage": { category: "protein", role: "main" },
  "sausages": { category: "protein", role: "main" },
  "cheddar cheese": { category: "dairy", role: "support" },
  "milk": { category: "dairy", role: "support" },
  "broccoli": { category: "vegetable", role: "main" },
  "brocolie": { category: "vegetable", role: "main" },
  "red beans": { category: "protein", role: "main" },
  "rice": { category: "carb", role: "main" },
  "flour": { category: "carb", role: "main" },
  "noodles": { category: "carb", role: "main" },
  "oreo": { category: "snack", role: "snack" },
  "oreos": { category: "snack", role: "snack" },
  "sugar": { category: "sweetener", role: "flavor" },
  "olive oil": { category: "fat", role: "support" },
  "peanut butter": { category: "fat", role: "support" },
  "vanila extract": { category: "flavor", role: "flavor" },
  "chillie flakes": { category: "spice", role: "flavor" },
  "curry pulver": { category: "spice", role: "flavor" },
  "backing pulver": { category: "leavening", role: "leavening" },
  // Add more as needed
};

/**
 * Meal templates: each is a list of required ingredient categories and forbidden roles.
 * Only generate combinations that match a template and do not include forbidden roles.
 */
const MEAL_TEMPLATES = [
  {
    name: "Omelette",
    requiredCategories: ["protein", "dairy"],
    allowedRoles: ["main", "support", "flavor", "vegetable"],
    forbiddenRoles: ["leavening", "snack"],
    minIngredients: 2,
    maxIngredients: 4,
  },
  {
    name: "Pasta",
    requiredCategories: ["carb", "dairy", "protein"],
    allowedRoles: ["main", "support", "flavor"],
    forbiddenRoles: ["leavening", "snack"],
    minIngredients: 2,
    maxIngredients: 4,
  },
  {
    name: "Stir-fry",
    requiredCategories: ["protein", "vegetable", "fat"],
    allowedRoles: ["main", "support", "flavor"],
    forbiddenRoles: ["leavening", "snack"],
    minIngredients: 2,
    maxIngredients: 4,
  },
  {
    name: "Snack",
    requiredCategories: ["snack"],
    allowedRoles: ["snack", "flavor", "support"],
    forbiddenRoles: ["leavening", "main"],
    minIngredients: 1,
    maxIngredients: 3,
  },
  // Add more templates as needed
];

// Optionally, a blacklist of forbidden ingredient pairs (for future use)
const FORBIDDEN_PAIRS = [
  ["backing pulver", "broccoli"],
  ["backing pulver", "chicken breast"],
  // Add more as needed
];

// --- Helper Functions ---

// Helper function to parse inventory quantity strings
const parseQuantity = (quantityString) => {
  if (!quantityString) {
    return null; // No quantity provided
  }

  const trimmed = quantityString.trim();

  // First, try to match number + unit (normal case)
  const match = trimmed.match(/^(\d*\.?\d+)\s*([a-zA-Z]+)/);
  if (match && match[1] && match[2]) {
    const quantity = parseFloat(match[1]);
    let unit = match[2].toLowerCase();

    // Normalize units
    if (unit === 'piece') unit = 'pcs';
    if (unit === 'pack' || unit === 'packs') unit = 'packs';

    const validUnits = ['g', 'kg', 'ml', 'l', 'oz', 'lb', 'piece', 'pcs', 'cup', 'tbsp', 'tsp', 'packs'];
    if (validUnits.includes(unit)) {
      return { quantity, unit };
    } else {
      console.warn(`Unrecognized unit '${match[2]}' in quantity string: '${quantityString}'`);
      return null;
    }
  }

  // Second, try to match just a number (assume pieces)
  const numOnly = trimmed.match(/^(\d*\.?\d+)$/);
  if (numOnly && numOnly[1]) {
    const quantity = parseFloat(numOnly[1]);
    return { quantity, unit: 'pcs' };
  }

  console.warn(`Could not parse quantity string: '${quantityString}'`);
  return null;
};

// Helper function to fetch nutritional info from USDA FoodData Central
const getNutritionalInfo = async (foodName) => {
  const FDC_API_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
  try {
    const params = new URLSearchParams();
    params.append('api_key', USDA_API_KEY);
    params.append('query', foodName);
    params.append('pageSize', '5');
    params.append('dataType', 'SR Legacy');
    params.append('dataType', 'Foundation');
    params.append('dataType', 'Branded');

    const response = await axios.get(`${FDC_API_URL}?${params.toString()}`);

    if (response.data && response.data.foods && response.data.foods.length > 0) {
      // Try to find the best match (e.g., first result)
      const food = response.data.foods[0];
      let calories = null;
      let protein = null;

      if (food.foodNutrients) {
        // Nutrient IDs: 208 = Energy (kcal), 203 = Protein
        const calorieNutrient = food.foodNutrients.find(n => n.nutrientId === 1008 || n.nutrientNumber === "208"); // FDC uses 1008 for kcal now, but 208 is common
        const proteinNutrient = food.foodNutrients.find(n => n.nutrientId === 1003 || n.nutrientNumber === "203"); // FDC uses 1003 for protein

        // Values are typically per 100g or 100ml unless otherwise specified
        if (calorieNutrient) {
          calories = calorieNutrient.value;
        }
         if (proteinNutrient) {
          protein = proteinNutrient.value;
        }

        if (calories !== null && protein !== null) {
          // Assuming values are per 100g/ml as is standard in FDC search results
          return { caloriesPer100Unit: calories, proteinPer100Unit: protein, unit: 'g or ml' }; // Indicate unit ambiguity
        }
      }
    }
    console.warn(`Nutritional info not found for: ${foodName}`);
    return null; // Not found or missing required nutrients
  } catch (error) {
    console.error(`Error fetching nutritional info for ${foodName}:`, error.response ? error.response.data : error.message);
    return null; // API error
  }
};

// Helper function to generate combinations of items from an array
// minK, maxK: min/max size of combinations
function generateCombinations(arr, minK, maxK) {
  const result = [];
  function combine(start, currentCombo) {
    if (currentCombo.length >= minK && currentCombo.length <= maxK) {
      result.push([...currentCombo]);
    }
    if (currentCombo.length >= maxK) {
        return; // Stop if we reached max size
    }
    for (let i = start; i < arr.length; i++) {
      currentCombo.push(arr[i]);
      combine(i + 1, currentCombo);
      currentCombo.pop();
    }
  }
  combine(0, []);
  // Filter for unique combinations based on item IDs (if needed, depends on input)
  // For now, assumes input array items are unique enough or duplicates are acceptable
  return result;
}

// Helper function to check portion limits for a single ingredient
// Note: This is a simplified check based primarily on unit. More sophisticated checks
// might involve categorizing food items (grain, meat, vegetable etc.)
function checkPortionLimits(item, usedQuantity) {
  const unit = item.availableUnit; // Use the parsed unit
  const name = item.name.toLowerCase();

  // Convert usedQuantity to grams if possible for comparison (simplistic)
  let usedQuantityG = null;
  if (unit === 'g') usedQuantityG = usedQuantity;
  if (unit === 'kg') usedQuantityG = usedQuantity * 1000;
  // Add other conversions (oz, lb) if needed

  if (unit === 'g' || unit === 'kg') {
    // Basic categorization attempt based on name keywords
    if (name.includes('rice') || name.includes('pasta') || name.includes('quinoa') || name.includes('bread') || name.includes('couscous')) {
       if (usedQuantityG > PORTION_LIMITS.MAX_GRAIN_UNCOOKED_G) return false;
    } else if (name.includes('chicken') || name.includes('beef') || name.includes('pork') || name.includes('fish') || name.includes('salmon') || name.includes('tuna') || name.includes('turkey') || name.includes('tofu') || name.includes('tempeh')) {
       // Assume uncooked unless 'cooked' is mentioned? Risky. Using uncooked limit for now.
       if (usedQuantityG > PORTION_LIMITS.MAX_MEAT_UNCOOKED_G) return false;
    } else if (name.includes('oats') || name.includes('oatmeal')) {
       if (usedQuantityG > PORTION_LIMITS.MAX_OATS_UNCOOKED_G) return false;
    } else if (name.includes('cheese')) {
       if (usedQuantityG > PORTION_LIMITS.MAX_CHEESE_G) return false;
    } else if (name.includes('nuts') || name.includes('seeds') || name.includes('almonds') || name.includes('peanut')) {
       if (usedQuantityG > PORTION_LIMITS.MAX_NUTS_SEEDS_G) return false;
    } else if (name.includes('spinach') || name.includes('lettuce') || name.includes('kale')) {
        if (usedQuantityG > PORTION_LIMITS.MAX_LEAFY_GREENS_G) return false;
    } else { // Assume general vegetable/other
        if (usedQuantityG > PORTION_LIMITS.MAX_SINGLE_VEGETABLE_G) return false;
    }
  } else if (unit === 'ml' || unit === 'l') {
      const usedQuantityMl = (unit === 'l') ? usedQuantity * 1000 : usedQuantity;
      if (usedQuantityMl > PORTION_LIMITS.MAX_LIQUID_ML) return false;
  } else if (unit === 'pcs') {
      if (name.includes('egg')) {
          if (usedQuantity > PORTION_LIMITS.MAX_EGGS_PCS) return false;
      } else if (name.includes('apple') || name.includes('banana') || name.includes('orange')) { // Example fruits
          if (usedQuantity > PORTION_LIMITS.MAX_FRUIT_PIECES) return false;
      }
      // Add more 'pcs' checks if needed
  }
  // Add checks for cup, tbsp, tsp if necessary (might require density estimates)

  return true; // Passed portion checks
}

// Helper function to calculate total nutrients for a list of ingredients
// Assumes ingredients have { usedQuantity, availableUnit, caloriesPer100Unit, proteinPer100Unit }
function calculateNutrients(ingredients) {
  let totalCalories = 0;
  let totalProtein = 0;

  for (const item of ingredients) {
    let quantityIn100Unit = 0;
    // Convert used quantity to the base unit (100g/ml) for calculation
    // This is highly simplified and assumes base unit is 'g or ml'
    if (item.availableUnit === 'g' || item.availableUnit === 'ml') {
      quantityIn100Unit = item.usedQuantity / 100;
    } else if (item.availableUnit === 'kg' || item.availableUnit === 'l') {
      quantityIn100Unit = (item.usedQuantity * 1000) / 100;
    } else if (item.availableUnit === 'pcs') {
        // MAJOR LIMITATION: Cannot accurately calculate nutrients for 'pcs' items
        // without knowing the weight/volume per piece. Skipping these for now.
        console.warn(`Cannot calculate nutrients accurately for item '${item.name}' with unit 'pcs'. Skipping.`);
        continue;
    }
     // Add other unit conversions (oz, lb, cup, tbsp, tsp) if needed, likely requiring approximations

    if (quantityIn100Unit > 0) {
        totalCalories += item.caloriesPer100Unit * quantityIn100Unit;
        totalProtein += item.proteinPer100Unit * quantityIn100Unit;
    }
  }

  return { calculatedCalories: Math.round(totalCalories), calculatedProtein: Math.round(totalProtein) };
}

// Helper function to check if calculated nutrients meet goals within tolerance
function checkGoalLimits(calculatedCalories, calculatedProtein, targetCalories, targetProtein) {
  // Updated tolerances: +/- 100 kcal, +/- 10g protein
  const CALORIE_TOLERANCE = 100;
  const PROTEIN_TOLERANCE = 10;

  const calorieDiff = Math.abs(calculatedCalories - targetCalories);
  const proteinDiff = Math.abs(calculatedProtein - targetProtein);

  return calorieDiff <= CALORIE_TOLERANCE && proteinDiff <= PROTEIN_TOLERANCE;
}


// --- App Setup ---
const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 } })); // Allow up to 25MB files

// --- Auth Middleware (must be defined before any route that uses it) ---
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

// --- Image Upload Route (MUST be before JSON body parsers) ---
app.post('/api/user/inventory/image', authenticateToken, async (req, res) => {
  try {
    // Debug: Log headers and files
    console.log('Image Upload Request Headers:', req.headers);
    if (!req.files || !req.files.foodImage) {
      console.error('No file uploaded. req.files:', req.files);
      return res.status(400).json({ success: false, message: 'No file uploaded.', debug: { files: req.files } });
    }

    const foodImage = req.files.foodImage;

    // Validate file type (allow only images)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(foodImage.mimetype)) {
      console.error('Invalid file type:', foodImage.mimetype);
      return res.status(400).json({ success: false, message: 'Invalid file type. Only JPEG, PNG, JPG, and WEBP are allowed.' });
    }

    // Validate file size (already limited by middleware, but double-check)
    if (foodImage.size > 25 * 1024 * 1024) {
      console.error('File too large:', foodImage.size);
      return res.status(400).json({ success: false, message: 'File too large. Max 25MB allowed.' });
    }

    // Save file to disk (optional: you may want to save to cloud or process directly)
    const path = require('path');
    const fs = require('fs');
    const uploadDir = path.join(__dirname, '../images');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const fileName = `upload_${Date.now()}_${foodImage.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const filePath = path.join(uploadDir, fileName);

    await foodImage.mv(filePath);

    // --- Food Recognition Model Integration ---
    let recognizedItems = [];
    let modelResponseText = '';
    try {
      const imageBuffer = fs.readFileSync(filePath);
      const imagePart = fileToGenerativePart(imageBuffer, foodImage.mimetype);
      const prompt = `Identify ONLY edible food items in the image. Return ONLY a JSON array of strings, e.g., ["Apples", "Milk Carton"]. If none, return [].`;

      console.log('[Food Recognition] Invoking model...');
      const result = await foodRecognitionModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }, imagePart] }],
        generationConfig: { temperature: 0.7, topP: 0.9, topK: 20, maxOutputTokens: 1024 },
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
        ]
      });

      modelResponseText = result.response.candidates[0].content.parts[0].text.trim();
      console.log('[Food Recognition] Raw model response:', modelResponseText);

      try {
        recognizedItems = JSON.parse(modelResponseText.replace(/^```json\s*|```$/g, '').trim());
        if (!Array.isArray(recognizedItems)) recognizedItems = [];
      } catch (parseErr) {
        console.error('[Food Recognition] Error parsing model response as JSON:', parseErr);
        recognizedItems = [];
      }
    } catch (modelErr) {
      console.error('[Food Recognition] Model invocation failed:', modelErr);
      recognizedItems = [];
    }

    // Respond with success, file info, and recognized items
    res.json({
      success: true,
      message: recognizedItems.length > 0
        ? 'Image uploaded and scanned successfully.'
        : 'Image uploaded, but no food items were recognized.',
      fileName,
      filePath: `/images/${fileName}`,
      mimetype: foodImage.mimetype,
      recognizedItems
    });
  } catch (err) {
    // Log full error for debugging
    console.error('Image upload error:', err, '| req.files:', req.files, '| req.headers:', req.headers);
    res.status(500).json({ success: false, message: 'Internal server error during image upload.' });
  }
});

app.use(express.json({ limit: '10mb' })); // Allow up to 10MB JSON payloads
app.use(express.urlencoded({ limit: '10mb', extended: true })); // Allow up to 10MB URL-encoded payloads

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ success: false, message: 'Username, email, and password are required.' });
  }
  try {
    const password_hash = await bcrypt.hash(password, saltRounds);
    // Supabase insert
    const { data, error } = await supabase
      .from('users')
      .insert({ username, email, password_hash })
      .select('id')
      .single(); // Expecting a single row back

    if (error) {
      // Check for Supabase unique constraint violation (code 23505)
      if (error.code === '23505') {
        return res.status(409).json({ success: false, message: 'Username or email already exists.' });
      }
      console.error('Supabase registration error:', error);
      return res.status(500).json({ success: false, message: 'Database error during registration.' });
    }

    res.status(201).json({ success: true, userId: data.id });
  } catch (error) {
    // Catch hashing errors or unexpected issues
    console.error('General registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }
  try {
    // Supabase select
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single(); // Expecting one user or null

    if (error && error.code !== 'PGRST116') { // PGRST116: Row not found (expected if email doesn't exist)
        console.error('Supabase login select error:', error);
        return res.status(500).json({ success: false, message: 'Database error during login.' });
    }
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Note: Supabase typically uses its own auth, but we keep JWT for now
    const token = jwt.sign({ userId: user.id, username: user.username, email: user.email }, jwtSecret, { expiresIn: '1h' });
    res.json({ success: true, username: user.username, token });
  } catch (error) {
    // Catch hashing errors or unexpected issues
    console.error('General login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.get('/api/user/goals', authenticateToken, async (req, res) => {
  try {
    // Supabase select
    const { data, error } = await supabase
      .from('user_goals')
      .select('calories, protein')
      .eq('user_id', req.user.userId)
      .maybeSingle(); // Returns data object or null if not found

    if (error) {
      console.error('Supabase fetch goals error:', error);
      return res.status(500).json({ success: false, message: 'Database error fetching goals.' });
    }

    res.json({ success: true, goals: data }); // data is null if no goals found
  } catch (err) {
    // Catch unexpected errors
    console.error('General fetch goals error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching goals.' });
  }
});

app.post('/api/user/goals', authenticateToken, async (req, res) => {
  const { calories, protein } = req.body;
  if (!calories || !protein) {
    return res.status(400).json({ success: false, message: 'Calories and protein are required.' });
  }
  try {
    // Supabase upsert (insert or update)
    const { error } = await supabase
      .from('user_goals')
      .upsert({ user_id: req.user.userId, calories: calories, protein: protein }); // Supabase handles conflict automatically based on primary key (user_id)

    if (error) {
      console.error('Supabase save goals error:', error);
      return res.status(500).json({ success: false, message: 'Database error saving goals.' });
    }

    res.json({ success: true, message: 'Goals saved.' });
  } catch (err) {
    // Catch unexpected errors
    console.error('General save goals error:', err);
    res.status(500).json({ success: false, message: 'Server error saving goals.' });
  }
});

app.get('/api/user/inventory', authenticateToken, async (req, res) => {
  try {
    // Supabase select
    const { data, error } = await supabase
      .from('user_inventory')
      .select('id, item_name, item_quantity, quantity, unit')
      .eq('user_id', req.user.userId)
      .order('item_name');

    if (error) {
      console.error('Supabase fetch inventory error:', error);
      return res.status(500).json({ success: false, message: 'Database error fetching inventory.' });
    }

    // Map to the expected frontend format (if needed, though Supabase returns similar structure)
    const inventory = data.map(row => ({
      id: row.id,
      name: row.item_name,
      item_quantity: row.item_quantity, // Keep original string for display?
      quantity: row.quantity, // Keep parsed numeric quantity
      unit: row.unit // Keep parsed unit
    }));
    res.json({ success: true, inventory });
  } catch (err) {
    // Catch unexpected errors
    console.error('General fetch inventory error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching inventory.' });
  }
});

app.post('/api/user/inventory', authenticateToken, async (req, res) => {
  const { itemName, itemQuantity, quantity, unit } = req.body;

  if (!itemName) {
    return res.status(400).json({ success: false, message: 'Item name is required.' });
  }

  // Validate quantity/unit if provided
  let parsedQuantity = null;
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    parsedQuantity = parseFloat(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive number.' });
    }
  }

  let normalizedUnit = null;
  if (unit) {
    const allowedUnits = ['g', 'kg', 'ml', 'l', 'pcs', 'oz', 'lb', 'cup', 'tbsp', 'tsp'];
    if (!allowedUnits.includes(unit.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid unit.' });
    }
    normalizedUnit = unit.toLowerCase();
  }

  try {
    // Supabase insert
    const { data, error } = await supabase
      .from('user_inventory')
      .insert({
        user_id: req.user.userId,
        item_name: itemName,
        item_quantity: itemQuantity || null, // Store original string if provided
        quantity: parsedQuantity, // Store parsed numeric quantity
        unit: normalizedUnit // Store parsed unit
      })
      .select('id, item_name, item_quantity, quantity, unit') // Select the fields to return
      .single(); // Expecting one row back

    if (error) {
      console.error('Supabase add inventory error:', error);
      return res.status(500).json({ success: false, message: 'Database error adding item.' });
    }

    // Map to expected frontend format (already matches)
    res.status(201).json({
      success: true,
      item: {
        id: data.id,
        name: data.item_name,
        item_quantity: data.item_quantity,
        quantity: data.quantity,
        unit: data.unit
      }
    });
  } catch (err) {
    // Catch unexpected errors
    console.error('General add inventory error:', err);
    res.status(500).json({ success: false, message: 'Server error adding item.' });
  }
});

app.delete('/api/user/inventory/:id', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.id);
  if (!itemId) return res.status(400).json({ success: false, message: 'Valid item ID required.' });
  try {
    // Supabase delete
    const { error, count } = await supabase
      .from('user_inventory')
      .delete()
      .match({ id: itemId, user_id: req.user.userId }); // Match both id and user_id for security

    if (error) {
      console.error('Supabase delete inventory error:', error);
      return res.status(500).json({ success: false, message: 'Database error deleting item.' });
    }
    // Supabase delete doesn't return count directly in v2, check error instead or perform a select first if count is critical
    // Assuming success if no error occurred for the matched criteria
    // if (count === 0) return res.status(404).json({ success: false, message: 'Item not found or not owned by user.' });

    res.json({ success: true, message: 'Item deleted.' });
  } catch (err) {
    // Catch unexpected errors
    console.error('General delete inventory error:', err);
    res.status(500).json({ success: false, message: 'Server error deleting item.' });
  }
});

app.put('/api/user/inventory/:id', authenticateToken, async (req, res) => {
  const itemId = parseInt(req.params.id);
  const { itemName, itemQuantity, quantity, unit } = req.body;

  if (!itemId || !itemName) {
    return res.status(400).json({ success: false, message: 'Valid item ID and name required.' });
  }

  // Validate quantity/unit if provided
  let parsedQuantity = null;
  if (quantity !== undefined && quantity !== null && quantity !== '') {
    parsedQuantity = parseFloat(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive number.' });
    }
  }

  let normalizedUnit = null;
  if (unit) {
    const allowedUnits = ['g', 'kg', 'ml', 'l', 'pcs', 'oz', 'lb', 'cup', 'tbsp', 'tsp'];
    if (!allowedUnits.includes(unit.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Invalid unit.' });
    }
    normalizedUnit = unit.toLowerCase();
  }

  try {
    // Supabase update
    const { data, error } = await supabase
      .from('user_inventory')
      .update({
        item_name: itemName,
        item_quantity: itemQuantity || null,
        quantity: parsedQuantity,
        unit: normalizedUnit
      })
      .match({ id: itemId, user_id: req.user.userId }) // Ensure user owns the item
      .select('id, item_name, item_quantity, quantity, unit') // Select fields to return
      .single(); // Expect one row updated

    if (error) {
        // Handle case where item not found or doesn't belong to user (e.g., error.code might indicate this)
        if (error.code === 'PGRST116') { // Row not found
             return res.status(404).json({ success: false, message: 'Item not found or not owned by user.' });
        }
        console.error('Supabase update inventory error:', error);
        return res.status(500).json({ success: false, message: 'Database error updating item.' });
    }
    if (!data) { // Should be redundant if error handling is correct, but good practice
        return res.status(404).json({ success: false, message: 'Item not found after update attempt.' });
    }

    // Map to expected frontend format (already matches)
    res.json({
      success: true,
      item: {
        id: data.id,
        name: data.item_name,
        item_quantity: data.item_quantity,
        quantity: data.quantity,
        unit: data.unit
      }
    });
  } catch (err) {
    // Catch unexpected errors
    console.error('General update inventory error:', err);
    res.status(500).json({ success: false, message: 'Server error updating item.' });
  }
});

app.post('/api/generate-plan', authenticateToken, async (req, res) => {
  const { mode, meal_type, goals, /* inventory_list is deprecated */ meal_calories, meal_protein } = req.body; // Removed inventory_list from destructuring

  // Input validation
  if (!mode || !meal_type || !goals || !meal_calories || !meal_protein) {
    return res.status(400).json({ success: false, message: 'Missing required fields: mode, meal_type, goals, meal_calories, meal_protein.' });
  }
  if (mode !== 'meal' && mode !== 'daily') {
     return res.status(400).json({ success: false, message: 'Invalid mode specified.' });
  }

  const userId = req.user.userId;
  const targetCalories = parseInt(meal_calories);
  const targetProtein = parseInt(meal_protein);
  if (isNaN(targetCalories) || isNaN(targetProtein) || targetCalories <= 0 || targetProtein <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid calorie or protein goals.' });
  }


  // --- Meal Generation Logic (mode === 'meal') ---
  if (mode === 'meal') {
    try {
      // 1. Fetch User Inventory from Supabase
      const { data: rawInventory, error: inventoryError } = await supabase
        .from('user_inventory')
        .select('id, item_name, item_quantity, quantity, unit') // Fetch all relevant fields
        .eq('user_id', userId)
        .order('item_name');

      if (inventoryError) {
        console.error('Supabase fetch inventory for meal plan error:', inventoryError);
        return res.status(500).json({ success: false, message: 'Database error fetching inventory for meal plan.' });
      }

      if (!rawInventory || rawInventory.length === 0) {
        return res.json({ success: false, message: "Your inventory is empty. Please add some items." });
      }

      // 2. Process Inventory: Use structured fields first, fallback to parsing old string
      const processedInventory = [];
      for (const item of rawInventory) {
        let quantityVal = null;
        let unitVal = null;

        if (item.quantity !== null && item.quantity !== undefined && !isNaN(item.quantity) && item.unit) {
          quantityVal = parseFloat(item.quantity);
          unitVal = item.unit.toLowerCase();
        } else {
          const parsedQty = parseQuantity(item.item_quantity);
          if (parsedQty) {
            quantityVal = parsedQty.quantity;
            unitVal = parsedQty.unit;
          }
        }

        // Piece-to-gram conversion for 'pcs' unit
        let usedQuantity = quantityVal;
        let usedUnit = unitVal;
        let usedDefault = false;
        if (quantityVal && unitVal === 'pcs') {
          // Normalize name for lookup
          const normName = item.item_name.trim().toLowerCase();
          if (PIECE_TO_GRAM_MAP[normName]) {
            usedQuantity = quantityVal * PIECE_TO_GRAM_MAP[normName];
            usedUnit = 'g';
            console.log(`Converted ${quantityVal} pcs of ${item.item_name} to ${usedQuantity}g using PIECE_TO_GRAM_MAP.`);
          } else {
            console.warn(`No piece-to-gram mapping for '${item.item_name}'. Skipping.`);
            continue; // Skip if no mapping
          }
        }

        // If still missing or unparseable, use default portion
        if ((!usedQuantity || !usedUnit) && item.item_name) {
          const normName = item.item_name.trim().toLowerCase();
          if (DEFAULT_PORTION_MAP[normName]) {
            usedQuantity = DEFAULT_PORTION_MAP[normName];
            usedUnit = 'g';
            usedDefault = true;
            console.warn(`Assuming default portion for '${item.item_name}': ${usedQuantity}g`);
          } else {
            usedQuantity = DEFAULT_PORTION_GRAMS;
            usedUnit = 'g';
            usedDefault = true;
            console.warn(`Assuming generic default portion for '${item.item_name}': ${usedQuantity}g`);
          }
        }

        if (usedQuantity && usedUnit) {
          if (usedDefault) {
            console.warn(`Used default portion for '${item.item_name}' (${usedQuantity}${usedUnit}) due to missing/invalid quantity/unit.`);
          }
          console.log(`Fetching nutritional info for: ${item.item_name}`);
          const nutritionalInfo = await getNutritionalInfo(item.item_name);
          if (nutritionalInfo) {
            processedInventory.push({
              id: item.id,
              name: item.item_name,
              availableQuantity: usedQuantity,
              availableUnit: usedUnit,
              caloriesPer100Unit: nutritionalInfo.caloriesPer100Unit,
              proteinPer100Unit: nutritionalInfo.proteinPer100Unit,
              baseUnit: nutritionalInfo.unit // 'g or ml'
            });
          } else {
            console.log(`Skipping ${item.item_name} - could not fetch nutritional info.`);
          }
        } else {
          console.log(`Skipping ${item.item_name} - missing or unparseable quantity/unit and no default available.`);
        }
      }

      if (processedInventory.length < 2) { // Need at least 2 ingredients with nutritional info for a basic meal
         return res.json({ success: false, message: "Not enough ingredients with usable quantity and nutritional information found in your inventory." });
      }

      console.log("Processed Inventory for Meal Generation:", JSON.stringify(processedInventory, null, 2));
      console.log(`Target Meal: Type=${meal_type}, Calories=${targetCalories}, Protein=${targetProtein}`);

      // 3. Generate Candidate Ingredient Combinations (2 to 5 ingredients)
      const MIN_INGREDIENTS = 2;
      const MAX_INGREDIENTS = 5;
      const allCombinations = generateCombinations(processedInventory, MIN_INGREDIENTS, MAX_INGREDIENTS);

      // Helper: Get ingredient categories for a combo
      function getComboCategories(combo) {
        return combo.map(item => INGREDIENT_CATEGORIES[item.name.trim().toLowerCase()] || "other");
      }

      // Helper: Check if a combo matches a template
      function matchesTemplate(combo) {
        const comboCats = combo.map(item => (INGREDIENT_CATEGORIES[item.name.trim().toLowerCase()] || {}).category || "other");
        const comboRoles = combo.map(item => (INGREDIENT_CATEGORIES[item.name.trim().toLowerCase()] || {}).role || "other");
        for (const template of MEAL_TEMPLATES) {
          // Check required categories
          const required = template.requiredCategories;
          if (!required) continue;
          const hasAll = required.every(cat => comboCats.includes(cat));
          if (!hasAll) continue;

          // Check forbidden roles
          const forbidden = template.forbiddenRoles || [];
          const hasForbidden = forbidden.some(role => comboRoles.includes(role));
          if (hasForbidden) continue;

          // Check allowed roles (all roles in combo must be allowed)
          const allowed = template.allowedRoles || [];
          const allAllowed = comboRoles.every(role => allowed.includes(role));
          if (!allAllowed) continue;

          // Check forbidden ingredient pairs
          let hasForbiddenPair = false;
          for (const [a, b] of FORBIDDEN_PAIRS) {
            const names = combo.map(i => i.name.trim().toLowerCase());
            if (names.includes(a) && names.includes(b)) {
              hasForbiddenPair = true;
              break;
            }
          }
          if (hasForbiddenPair) continue;

          // Check ingredient count
          if (combo.length < template.minIngredients || combo.length > template.maxIngredients) continue;

          // Passed all checks
          return true;
        }
        return false;
      }

      // Filter combinations to only those matching a template, or fallback to simple combos if none
      let candidateCombinations = allCombinations.filter(matchesTemplate);
      if (candidateCombinations.length === 0) {
        // Fallback: allow all 2-ingredient combos
        candidateCombinations = allCombinations.filter(combo => combo.length === 2);
        console.warn("No template-matching combos found, falling back to simple 2-ingredient combos.");
      }

      console.log(`Generated ${candidateCombinations.length} candidate combinations (after template filtering).`);

      let validRecipes = [];
      let potentialClosestMatches = [];

      // 4. Evaluate Each Candidate Combination
      for (const combination of candidateCombinations) {
        console.log(`Evaluating combination: ${combination.map(item => item.name).join(', ')}`);

        // --- Step 4a: Determine Feasible Quantities (MAJOR TODO) ---
        // This is where a complex algorithm would try to find quantities.
        // For now, using placeholders - ASSUME determinedQuantities is populated.
        // Example: Maybe start with a fraction of target calories/protein per item?
        // Or use a simpler approach: try using 100g/ml/1pc of each? Very naive.
        // THIS NEEDS A REAL IMPLEMENTATION LATER.
        let determinedQuantities = combination.map(item => ({
            ...item, // Keep original info from combination
            // Placeholder: Use a small fixed amount or fraction of available?
            // Using 1/N of available (up to a max) as a *very* rough placeholder
            usedQuantity: Math.round(Math.min(item.availableQuantity / combination.length, (item.availableUnit === 'g' || item.availableUnit === 'kg') ? 100 : (item.availableUnit === 'ml' || item.availableUnit === 'l') ? 100 : 1) * 10) / 10, // Rounded placeholder
            usedUnit: item.availableUnit
        }));
        // --- End Step 4a Placeholder ---


        // --- Step 4b: Constraint Checking ---
        let passesInventoryCheck = true;
        let passesPortionCheck = true;

        for (const item of determinedQuantities) {
          // Inventory Check
          if (item.usedQuantity > item.availableQuantity) {
            passesInventoryCheck = false;
            console.log(`[REJECT] Inventory check failed for ${item.name}: needed ${item.usedQuantity}, have ${item.availableQuantity}`);
            break;
          }
          // Portion Check
          if (!checkPortionLimits(item, item.usedQuantity)) {
            passesPortionCheck = false;
            console.log(`[REJECT] Portion check failed for ${item.name}: used ${item.usedQuantity} ${item.usedUnit}`);
            break;
          }
        }

        // Nutritional Calculation (only if inventory/portion checks pass)
        let calculatedNutrients = { calculatedCalories: 0, calculatedProtein: 0 };
        if (passesInventoryCheck && passesPortionCheck) {
          calculatedNutrients = calculateNutrients(determinedQuantities);
        }

        // Goal Check
        let passesGoalCheck = false;
        if (passesInventoryCheck && passesPortionCheck) {
          passesGoalCheck = checkGoalLimits(
            calculatedNutrients.calculatedCalories,
            calculatedNutrients.calculatedProtein,
            targetCalories,
            targetProtein
          );
        }

        // Meal Type Check (Basic Placeholder - Needs proper implementation)
        // TODO: Implement meal type logic based on ingredients and meal_type input
        let passesMealTypeCheck = true; // Assume true for now

        // --- Debug Logging for Diagnostics ---
        if (!passesInventoryCheck) {
          console.log(`[REJECT] Combination failed inventory check: ${combination.map(i => i.name).join(', ')}`);
        }
        if (!passesPortionCheck) {
          console.log(`[REJECT] Combination failed portion check: ${combination.map(i => i.name).join(', ')}`);
        }
        if (passesInventoryCheck && passesPortionCheck) {
          console.log(`[CHECK] Combination: ${combination.map(i => i.name).join(', ')} | Cals: ${calculatedNutrients.calculatedCalories}, Prot: ${calculatedNutrients.calculatedProtein} | Goal: ${targetCalories} kcal, ${targetProtein}g`);
          if (!passesGoalCheck) {
            console.log(`[REJECT] Combination failed nutritional goal check (outside tolerance): ${combination.map(i => i.name).join(', ')}`);
          }
        }

        // --- Step 4c: Store Valid Candidates & Closest Matches ---
        if (passesInventoryCheck && passesPortionCheck && passesMealTypeCheck) {
          const recipeCandidate = {
            ingredients: determinedQuantities.map(i => ({
              name: i.name,
              usedQuantity: Math.round(i.usedQuantity * 10) / 10,
              usedUnit: i.usedUnit
            })),
            calculatedCalories: calculatedNutrients.calculatedCalories,
            calculatedProtein: calculatedNutrients.calculatedProtein,
          };

          if (passesGoalCheck) {
            console.log(`[ACCEPT] Valid recipe found: ${recipeCandidate.ingredients.map(i=>i.name).join(', ')} - Cals: ${recipeCandidate.calculatedCalories}, Prot: ${recipeCandidate.calculatedProtein}`);
            validRecipes.push(recipeCandidate);
          } else {
            console.log(`[CLOSEST] Potential closest match: ${recipeCandidate.ingredients.map(i=>i.name).join(', ')} - Cals: ${recipeCandidate.calculatedCalories}, Prot: ${recipeCandidate.calculatedProtein}`);
            potentialClosestMatches.push(recipeCandidate);
          }
        } else {
          console.log(`[REJECT] Combination failed pre-checks (Inventory, Portion, or Meal Type): ${combination.map(item => item.name).join(', ')}`);
        }
      } // End loop through combinations


      // --- Step 5: Prioritization/Selection & Closest Match ---
      console.log(`Found ${validRecipes.length} valid recipes and ${potentialClosestMatches.length} potential closest matches.`);

      let finalRecipe = null;
      let isClosestMatch = false;
      let notificationMessage = null;

      if (validRecipes.length > 0) {
        // Prioritization: Simplest - take the first valid one found.
        // TODO: Implement better prioritization (e.g., based on templates, fewer ingredients)
        finalRecipe = validRecipes[0];
        console.log("Selected a valid recipe meeting goals.");
      } else if (potentialClosestMatches.length > 0) {
        // Activate Closest Match Protocol
        console.log("No recipe met exact goals. Activating Closest Match Protocol.");
        isClosestMatch = true;
        notificationMessage = "Unfortunately, I couldn't meet your exact nutritional goals with the current inventory and portion constraints. Here is the closest possible recipe:";

        // Find the closest match numerically
        let bestMatch = null;
        let minDistance = Infinity;

        for (const match of potentialClosestMatches) {
          // Simple distance metric (can be weighted)
          const distance = Math.abs(match.calculatedCalories - targetCalories) + Math.abs(match.calculatedProtein - targetProtein);
          if (distance < minDistance) {
            minDistance = distance;
            bestMatch = match;
          }
        }
        finalRecipe = bestMatch;
        console.log(`Selected closest match recipe. Distance: ${minDistance}`);
      }

      // --- Step 6: Meal Naming & Instruction Generation (Placeholder) ---
      let mealName = "Generated Meal"; // Placeholder
      let instructions = ["Placeholder: Cook ingredients.", "Placeholder: Serve."]; // Placeholder

      if (finalRecipe) {
        // TODO: Implement LLM call for naming and instructions based on finalRecipe.ingredients
        // Example Prompt: "Generate a suitable, common meal name and simple, step-by-step cooking instructions for a single serving meal consisting of exactly: [formatted ingredient list]. Prioritize clarity and standard cooking techniques."
        // For now, generate a basic name
        mealName = finalRecipe.ingredients.map(i => i.name).slice(0, 3).join(' and ') + " Dish"; // Simple name
      } else {
        // No recipe could be generated at all (even closest match failed basic checks)
        return res.json({ success: false, message: "Could not generate any suitable recipe with the available ingredients and constraints." });
      }

      // --- Step 7: Format Final Response ---
      return res.json({
        success: true,
        data: {
          notification: notificationMessage, // Will be null if exact match found
          approxCalories: finalRecipe.calculatedCalories,
          approxProtein: finalRecipe.calculatedProtein,
          mealName: mealName,
          ingredients: finalRecipe.ingredients, // Already formatted { name, usedQuantity, usedUnit }
          instructions: instructions, // Placeholder for now
        },
        message: "Inventory processed, nutritional data fetched. Meal generation algorithm not yet implemented.",
        debug_data: {
          target_calories: targetCalories,
          target_protein: targetProtein,
          meal_type: meal_type,
          processed_inventory_count: processedInventory.length,
          // processed_inventory: processedInventory // Optional: include for debugging
        }
      });
      // --- End Placeholder ---

    } catch (error) {
      console.error("Error during meal generation:", error);
      return res.status(500).json({ success: false, message: 'Internal server error during meal generation.' });
    }

  // --- Daily Plan Generation Logic (mode === 'daily') ---
  } else if (mode === 'daily') {
    // Fetch inventory string for the prompt using Supabase
    const { data: dailyInventory, error: dailyInventoryError } = await supabase
        .from('user_inventory')
        .select('item_name, item_quantity') // Only need these for the string prompt
        .eq('user_id', userId)
        .order('item_name');

    if (dailyInventoryError) {
        console.error('Supabase fetch inventory for daily plan error:', dailyInventoryError);
        return res.status(500).json({ success: false, message: 'Database error fetching inventory for daily plan.' });
    }

    const inventory_list_for_prompt = dailyInventory || []; // Use fetched data or empty array
    const inventoryString = inventory_list_for_prompt.map(item => `${item.item_name}${item.item_quantity ? ` (${item.item_quantity})` : ''}`).join(', ') || 'no items provided';
    const dailyGoalString = `User's approximate daily goals: ${goals.calories || 'Not specified'} kcal, ${goals.protein || 'Not specified'}g protein.`; // Assuming goals still passed for daily

    // NOTE: Daily plan generation still uses the old LLM approach.
    // This part is NOT updated by the new strict meal generation logic.
    // It could be refactored later if needed.
    let responseJsonStructure = ''; // Define here for scope
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
      temperature: 0.4,
      topP: 0.9,
      topK: 20,
      maxOutputTokens: 1024,
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
    console.log("Raw AI Meal Response:", responseText);

    if (mode === 'meal') {
      if (responseText.startsWith("Calories:")) {
        const firstLineEnd = responseText.indexOf('\n');
        const nutritionLine = responseText.substring(0, firstLineEnd).trim();
        const remainingText = responseText.substring(firstLineEnd + 1).trim();

        const mealNameMatch = remainingText.match(/Meal Name:\s*(.+?)(?=\n|$)/i);
        const meal_name = mealNameMatch ? mealNameMatch[1].trim() : "Generated Meal";

        // Robustly extract recipe section line-by-line
        const lines = remainingText.split('\n');
        let foundRecipeMarker = false;
        const recipeLines = [];
        for (let line of lines) {
          if (foundRecipeMarker) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              recipeLines.push(trimmed);
            }
          } else {
            if (line.trim().toLowerCase().startsWith('recipe:')) {
              foundRecipeMarker = true;
            }
          }
        }
        let recipe = '';
        if (foundRecipeMarker) {
          recipe = recipeLines.join('\n').trim();
        } else {
          recipe = '';
        }

        const calMatch = nutritionLine.match(/Calories:\s*(\d+)/i);
        const proteinMatch = nutritionLine.match(/Protein:\s*(\d+)g/i);

        const estimated_calories = calMatch ? parseInt(calMatch[1]) : null;
        const estimated_protein = proteinMatch ? parseInt(proteinMatch[1]) : null;

        res.json({
          success: true,
          data: {
            can_generate: true,
            meal_name,
            estimated_calories,
            estimated_protein,
            recipe
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

app.post('/api/generate-meal', authenticateToken, async (req, res) => {
  req.body.mode = 'meal';
  const fakeNext = () => {};
  await (async (req, res, next) => {
    try {
      await app._router.stack.find(r => r.route && r.route.path === '/api/generate-plan').route.stack[1].handle(req, res, next);
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, message: 'Error forwarding to generate-plan.' });
    }
  })(req, res, fakeNext);
});

function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    }
  };
}

/* (route moved above JSON body parsers) */
/* (removed stray code fragment causing SyntaxError) */

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
