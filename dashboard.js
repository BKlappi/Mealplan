// --- Keys & State ---
const LOGGED_IN_USER_KEY = 'loggedInUserEmail'; // Needed for auth checks maybe? Keep for now.
const LOGGED_IN_USERNAME_KEY = 'loggedInUsername'; // Used for greeting
// Removed GOALS_STORAGE_KEY and INVENTORY_STORAGE_KEY as they are no longer used
let currentGoals = {}; // State variable for goals
let currentInventory = []; // State variable for inventory
const defaultGoals = { calories: 2500, protein: 150 };
const defaultInventory = [ { name: 'Example Bread', quantity: '1 loaf' } ];
let editingInventoryIndex = null; // null means adding, number means editing index

// Base URL for API calls
const API_BASE_URL = 'https://mealplan-backend-9d1p.onrender.com/api';

// --- Helper Functions ---

// Helper function for making authenticated API calls
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem('authToken');
    if (!token) {
        console.error("fetchWithAuth: No auth token found. Redirecting to login.");
        // Redirect to login if no token is found
        window.location.href = 'login.html';
        throw new Error("Authentication token not found."); // Prevent further execution
    }

    const headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json', // Assume JSON unless specified otherwise
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 || response.status === 403) {
        // Handle unauthorized or forbidden errors, e.g., redirect to login
        console.error("fetchWithAuth: Unauthorized or Forbidden. Redirecting to login.");
        localStorage.removeItem('authToken'); // Clear invalid token
        localStorage.removeItem(LOGGED_IN_USER_KEY);
        localStorage.removeItem(LOGGED_IN_USERNAME_KEY);
        window.location.href = 'login.html';
        throw new Error("Unauthorized or Forbidden."); // Prevent further execution
    }

    return response; // Return the full response object
}

// Updated showFeedback to use new CSS classes
function showFeedback(elementId, message, type = 'info', duration = 4000) {
    const element = document.getElementById(elementId);
    if (!element) { console.warn("showFeedback: target element missing", elementId); return; }

    // Clear previous timeout if exists
    if (element.feedbackTimeout) { clearTimeout(element.feedbackTimeout); }

    element.textContent = message;
    // Set base class, type class (error/success/info), and visible
    element.className = `feedback-message ${type} visible`; // Ensure base class is always present

    // Auto-hide after duration if duration is positive
    if (duration > 0) {
         element.feedbackTimeout = setTimeout(() => {
             hideFeedback(elementId); // Call hideFeedback to properly reset classes
         }, duration);
    }
}

// Updated hideFeedback to use new CSS classes
function hideFeedback(elementId) {
     const element = document.getElementById(elementId);
     if (element) {
         // Clear timeout if hiding manually before it expires
         if (element.feedbackTimeout) { clearTimeout(element.feedbackTimeout); }
         element.textContent = '';
         // Reset to base class only (hides it due to opacity/display none in CSS)
         element.className = 'feedback-message';
      }
 }
 
 // --- SPA View Functions Removed ---
 
 // --- Core Display Functions ---
 function displayUserGreeting() {
    console.log("FUNC: displayUserGreeting"); const el = document.querySelector('.user-greeting'); const name = localStorage.getItem(LOGGED_IN_USERNAME_KEY); if (!el) return; const cur = el.textContent; if (name) { el.textContent = `Welcome, ${name}!`; } else { el.textContent = "Welcome!"; } console.log(`--> Greet Set: "${cur}" >> "${el.textContent}"`);
}
function displayGoals() {
    console.log("FUNC: displayGoals"); const calsEl = document.getElementById('user-calories'); const protEl = document.getElementById('user-protein'); if (!calsEl || !protEl) return; const curC = calsEl.textContent; const curP = protEl.textContent; calsEl.textContent = currentGoals.calories ?? '...'; protEl.textContent = currentGoals.protein ?? '...'; console.log(`--> Goals Set: C="${curC}">>"${calsEl.textContent}", P="${curP}">>"${protEl.textContent}"`);
}
function displayInventory() {
    console.log("FUNC: displayInventory"); const listEl = document.getElementById('inventory-list'); if (!listEl) {console.error("displayInventory: List Missing"); return;} console.log("--> Inv state before render:", JSON.stringify(currentInventory)); listEl.innerHTML = ''; if (!currentInventory || currentInventory.length === 0) { listEl.innerHTML = '<li>Inventory is empty. Add items!</li>'; return; } console.log(`Rendering ${currentInventory.length} items...`);
    currentInventory.forEach((item, index) => {
         if (!item || typeof item.name === 'undefined') { console.warn("Skipping bad inv item:", item); return; }
         const li = document.createElement('li'); const textNode = document.createTextNode(`${item.name}${item.quantity ? ` - ${item.quantity}` : ''}`); li.appendChild(textNode);
         const buttonsDiv = document.createElement('div'); buttonsDiv.classList.add('item-buttons');
         const editBtn = document.createElement('button'); editBtn.textContent = 'Edit'; editBtn.classList.add('edit-item-button'); editBtn.dataset.index = index; editBtn.addEventListener('click', handleStartEditItem); buttonsDiv.appendChild(editBtn);
         const removeBtn = document.createElement('button'); removeBtn.textContent = 'Remove'; removeBtn.classList.add('remove-button'); removeBtn.dataset.index = index; removeBtn.addEventListener('click', handleRemoveItem); buttonsDiv.appendChild(removeBtn);
         li.appendChild(buttonsDiv); listEl.appendChild(li);
     }); console.log("--> Inv render finished.");
}

// *** Refactored loadData Function to fetch from Backend ***
async function loadData() { // Make async
    console.log("FUNC: loadData (fetching from backend)");
    // Still check if user is logged in locally first
    const userEmail = localStorage.getItem(LOGGED_IN_USER_KEY);
    if (!userEmail) {
        console.error("loadData: User email not found in localStorage. Redirecting to login.");
        window.location.href = 'login.html';
        return;
    }

    // Display greeting immediately
    displayUserGreeting();

    try {
        // Fetch goals and inventory in parallel
        const [goalsResponse, inventoryResponse] = await Promise.all([
            fetchWithAuth(`${API_BASE_URL}/user/goals`),
            fetchWithAuth(`${API_BASE_URL}/user/inventory`)
        ]);

        // Process Goals
        if (!goalsResponse.ok) {
            console.error(`Error fetching goals: ${goalsResponse.status} ${goalsResponse.statusText}`);
            showFeedback('goals-feedback', 'Error loading goals.', 'error');
            currentGoals = { ...defaultGoals }; // Use default on error
        } else {
            const goalsData = await goalsResponse.json();
            if (goalsData.success && goalsData.goals) {
                currentGoals = goalsData.goals;
            } else {
                 console.log("No goals found for user or API error, using defaults.");
                 currentGoals = { ...defaultGoals }; // Use default if no goals set
            }
        }

        // Process Inventory
        if (!inventoryResponse.ok) {
            console.error(`Error fetching inventory: ${inventoryResponse.status} ${inventoryResponse.statusText}`);
            showFeedback('inventory-feedback', 'Error loading inventory.', 'error');
            currentInventory = [...defaultInventory]; // Use default on error
        } else {
            const inventoryData = await inventoryResponse.json();
            if (inventoryData.success && Array.isArray(inventoryData.inventory)) {
                currentInventory = inventoryData.inventory;
            } else {
                console.warn("Inventory data from API was not successful or not an array, using empty array.");
                currentInventory = []; // Use empty array if API data is bad
            }
        }

        console.log("--> Data loaded from backend:", { currentGoals, currentInventory });

        // Update UI
        displayGoals();
        displayInventory();

    } catch (error) {
        // This catches errors from fetchWithAuth (like token issues) or Promise.all
        console.error("loadData failed:", error);
        // If fetchWithAuth didn't already redirect, show a generic error
        if (!window.location.href.endsWith('login.html')) {
             showFeedback('goals-feedback', 'Error loading data. Please try logging in again.', 'error');
             showFeedback('inventory-feedback', 'Error loading data. Please try logging in again.', 'error');
             // Optionally load defaults or clear UI
             currentGoals = { ...defaultGoals };
             currentInventory = [...defaultInventory];
             displayGoals();
             displayInventory();
        }
    }
    console.log("loadData finished");
 }

// --- Mode Change Handler ---
function handleModeChange() {
    const mode = document.querySelector('input[name="generation-mode"]:checked').value;
    const mealTypeGroup = document.getElementById('meal-type-group');
    const mealGoalInputs = document.getElementById('meal-goal-inputs');
    const generateBtn = document.getElementById('generate-plan-btn');
    const mealPlanContent = document.getElementById('meal-plan-content');

    console.log(`Mode changed to: ${mode}`);

    if (mode === 'meal') {
        mealTypeGroup.classList.remove('hidden');
        mealGoalInputs.classList.remove('hidden');
        generateBtn.textContent = 'Generate Meal Idea';
        //mealPlanContent.innerHTML = '<p>Select meal type, optionally set specific goals, and generate.</p>'; // Reset content area
    } else { // daily mode
        mealTypeGroup.style.display = 'none';
        mealGoalInputs.classList.add('hidden');
        generateBtn.textContent = 'Generate Daily Plan';
        //mealPlanContent.innerHTML = '<p>Click button to generate a full day plan based on your daily goals and inventory.</p>'; // Reset content area
    }
    hideFeedback('meal-plan-feedback'); // Hide any previous feedback
}


 // --- Action Handlers ---
function showGoalsForm() {
    console.log("HANDLER: showGoalsForm"); const dispEl=document.getElementById('goals-display'); const formEl=document.getElementById('goals-form'); const editBtnEl=document.getElementById('edit-goals-btn'); const calIn=document.getElementById('edit-calories'); const protIn=document.getElementById('edit-protein'); hideFeedback('goals-feedback');
    if(dispEl&&formEl&&editBtnEl&&calIn&&protIn){ console.log("Toggling classes SHOW form"); calIn.value=currentGoals.calories||''; protIn.value=currentGoals.protein||''; dispEl.classList.add('hidden'); formEl.classList.remove('hidden'); editBtnEl.classList.add('hidden');} else {console.warn("Elements missing showGoalsForm");}
}
function hideGoalsForm() {
     console.log("HANDLER: hideGoalsForm"); const dispEl=document.getElementById('goals-display'); const formEl=document.getElementById('goals-form'); const editBtnEl=document.getElementById('edit-goals-btn');
     if(dispEl&&formEl&&editBtnEl){ console.log("Toggling classes HIDE form"); dispEl.classList.remove('hidden'); formEl.classList.add('hidden'); editBtnEl.classList.remove('hidden'); } else {console.warn("Elements missing hideGoalsForm");}
}
async function handleSaveGoals(event) { // Make async
     console.log("HANDLER: handleSaveGoals (saving to backend)");
     event.preventDefault();
     const calIn = document.getElementById('edit-calories');
     const protIn = document.getElementById('edit-protein');
     hideFeedback('goals-feedback');
     if (!calIn || !protIn) return;

     const newCalories = parseInt(calIn.value);
     const newProtein = parseInt(protIn.value);

     if (isNaN(newCalories) || isNaN(newProtein) || newCalories <= 0 || newProtein <= 0) {
         showFeedback('goals-feedback', 'Valid positive numbers are required for goals.', 'error');
         return;
     }

     const goalsToSave = { calories: newCalories, protein: newProtein };

     try {
         const response = await fetchWithAuth(`${API_BASE_URL}/user/goals`, {
             method: 'POST',
             body: JSON.stringify(goalsToSave)
         });

         if (!response.ok) {
             const errorData = await response.json().catch(() => ({})); // Try to parse error JSON
             throw new Error(`Failed to save goals: ${response.status} ${response.statusText} - ${errorData.message || 'Unknown error'}`);
         }

         const data = await response.json();
         if (data.success) {
             currentGoals = goalsToSave; // Update local state on success
             console.log("Goals saved to backend", currentGoals);
             displayGoals();
             hideGoalsForm();
             showFeedback('goals-feedback', 'Goals Saved!', 'success');
         } else {
             showFeedback('goals-feedback', data.message || 'Failed to save goals.', 'error');
         }
     } catch (error) {
         console.error("Error saving goals:", error);
         showFeedback('goals-feedback', `Error saving goals: ${error.message}`, 'error');
     }
 }
function handleStartEditItem(event) {
     console.log("HANDLER: handleStartEditItem"); const index=parseInt(event.target.dataset.index); const item=currentInventory[index]; const nameIn=document.getElementById('item-name'); const quantIn=document.getElementById('item-quantity'); const submitBtn=document.getElementById('add-update-inventory-btn'); if(isNaN(index)||!item||!nameIn||!quantIn||!submitBtn){console.error("Start Edit Err"); return;} editingInventoryIndex=index; nameIn.value=item.name; quantIn.value=item.quantity||''; submitBtn.textContent='Update Item'; submitBtn.classList.add('update-mode'); nameIn.focus(); hideFeedback('inventory-feedback'); console.log("--> Edit form populated.");
 }
async function handleInventorySubmit(event) { // Make async
    console.log("HANDLER: handleInventorySubmit (saving to backend)");
    event.preventDefault();
    const nameIn = document.getElementById('item-name');
    const quantIn = document.getElementById('item-quantity');
    const formEl = document.getElementById('add-inventory-form');
    hideFeedback('inventory-feedback');
    if (!nameIn || !quantIn || !formEl) return;

    const name = nameIn.value.trim();
    const quantity = quantIn.value.trim();
    if (!name) {
        showFeedback('inventory-feedback', 'Item name is required.', 'error');
        return;
    }
    console.log("Inv Submit: editing index =", editingInventoryIndex);

    const itemData = { itemName: name, itemQuantity: quantity };
    let url = `${API_BASE_URL}/user/inventory`;
    let method = 'POST';
    let successMessage = 'Item Added!';

    // If editing, change method to PUT and add item ID to URL
    if (editingInventoryIndex !== null) {
        const itemToEdit = currentInventory[editingInventoryIndex];
        // Ensure the item exists and has an ID (fetched from backend)
        if (!itemToEdit || typeof itemToEdit.id === 'undefined') {
            console.error("handleInventorySubmit: Cannot update item, ID missing or invalid index.", itemToEdit);
            showFeedback('inventory-feedback', 'Error updating item: Invalid item selected or ID missing.', 'error');
            resetInventoryForm(); // Reset form state
            return;
        }
        url += `/${itemToEdit.id}`;
        method = 'PUT';
        successMessage = 'Item Updated!';
    }

    try {
        const response = await fetchWithAuth(url, {
            method: method,
            body: JSON.stringify(itemData)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Failed to ${method === 'POST' ? 'add' : 'update'} item: ${response.status} ${response.statusText} - ${errorData.message || 'Unknown error'}`);
        }

        const resultData = await response.json();
        if (resultData.success && resultData.item) {
            // Update local inventory state based on response from backend
            if (method === 'POST') {
                // Add the new item (which includes the ID from the backend)
                currentInventory.push(resultData.item);
            } else {
                // Update the item at the correct index
                currentInventory[editingInventoryIndex] = resultData.item;
            }
            console.log(`Inventory ${method === 'POST' ? 'added' : 'updated'} via backend`, resultData.item);
            displayInventory(); // Re-render the list with updated data
            resetInventoryForm(); // Clear the form
            showFeedback('inventory-feedback', successMessage, 'success');
        } else {
            // Handle cases where the backend reports success: false or item is missing
            showFeedback('inventory-feedback', resultData.message || `Failed to ${method === 'POST' ? 'add' : 'update'} item.`, 'error');
        }
    } catch (error) {
        // Handle network errors or errors from fetchWithAuth
        console.error(`Error ${method === 'POST' ? 'adding' : 'updating'} inventory item:`, error);
        showFeedback('inventory-feedback', `Error: ${error.message}`, 'error');
    }
}
function resetInventoryForm() {
     console.log("HANDLER: resetInventoryForm"); const formEl=document.getElementById('add-inventory-form'); const submitBtn=document.getElementById('add-update-inventory-btn'); if(formEl)formEl.reset(); if(submitBtn){submitBtn.textContent='Add Item'; submitBtn.classList.remove('update-mode');} editingInventoryIndex=null; hideFeedback('inventory-feedback'); console.log("--> Form reset to Add.");
 }
async function handleRemoveItem(event) { // Make async
     const indexToRemove = parseInt(event.target.dataset.index, 10);
     if (isNaN(indexToRemove)) return;

     const itemToRemove = currentInventory[indexToRemove];
     if (!itemToRemove || typeof itemToRemove.id === 'undefined') {
         console.error("Remove Err: Invalid item or missing ID.", itemToRemove);
         showFeedback('inventory-feedback', 'Error removing item: Invalid item selected or ID missing.', 'error');
         return;
     }
     console.log(`HANDLER: handleRemoveItem idx:${indexToRemove} ID:${itemToRemove.id} Name:"${itemToRemove.name}"`);
     hideFeedback('inventory-feedback');

     // Use window.confirm
     if (window.confirm(`Are you sure you want to remove "${itemToRemove.name}"?`)) {
         console.log("--> User CONFIRMED remove.");

         try {
             const response = await fetchWithAuth(`${API_BASE_URL}/user/inventory/${itemToRemove.id}`, {
                 method: 'DELETE'
             });

             if (!response.ok) {
                 const errorData = await response.json().catch(() => ({}));
                 throw new Error(`Failed to delete item: ${response.status} ${response.statusText} - ${errorData.message || 'Unknown error'}`);
             }

             const data = await response.json();
             if (data.success) {
                 // Reset edit form if the removed item was being edited
                 if (editingInventoryIndex === indexToRemove) {
                     resetInventoryForm();
                 }
                 // Remove item from local state
                 currentInventory.splice(indexToRemove, 1);
                 console.log("Inventory item removed via backend", itemToRemove);
                 displayInventory(); // Re-render list
                 showFeedback('inventory-feedback', `"${itemToRemove.name}" Removed`, 'success');
             } else {
                 showFeedback('inventory-feedback', data.message || 'Failed to remove item.', 'error');
             }
         } catch (error) {
             console.error("Error removing inventory item:", error);
             showFeedback('inventory-feedback', `Error: ${error.message}`, 'error');
         }
     } else {
         console.log("--> User CANCELED remove.");
     }
 }
 function handleLogout(event) {
     console.log("HANDLER: handleLogout");
     event.preventDefault();
     // Clear all relevant local storage items on logout
     localStorage.removeItem(LOGGED_IN_USER_KEY);
     localStorage.removeItem(LOGGED_IN_USERNAME_KEY);
     localStorage.removeItem('authToken'); // Also remove the auth token
     // We no longer need to remove user-specific goals/inventory keys as they aren't used
     window.location.href = 'index.html';
 }

// Updated function to call the backend API and handle different modes
async function handleGeneratePlan() {
    console.log("HANDLER: handleGeneratePlan");
    const mealPlanContentEl = document.getElementById('meal-plan-content');
    const generateBtn = document.getElementById('generate-plan-btn');
    const selectedMode = document.querySelector('input[name="generation-mode"]:checked').value;

    if (!mealPlanContentEl || !generateBtn) {
        console.error("Generate plan elements missing!");
        return;
    }

    // --- UI Update: Show Loading State ---
    mealPlanContentEl.innerHTML = `<p><i>Generating ${selectedMode === 'daily' ? 'daily plan' : 'meal idea'}...</i></p>`;
    generateBtn.disabled = true;
    hideFeedback('meal-plan-feedback');

    // Prepare request body based on mode
    const requestBody = {
        mode: selectedMode,
        goals: currentGoals, // Always send daily goals for context
        inventory_list: currentInventory
    };

    if (selectedMode === 'meal') {
        const mealTypeSelectEl = document.getElementById('meal-type-select');
        const mealCaloriesInput = document.getElementById('meal-calories');
        const mealProteinInput = document.getElementById('meal-protein');

        requestBody.meal_type = mealTypeSelectEl?.value;
        requestBody.meal_calories = mealCaloriesInput?.value ? parseInt(mealCaloriesInput.value) : null;
        requestBody.meal_protein = mealProteinInput?.value ? parseInt(mealProteinInput.value) : null;
    } else {
        requestBody.meal_type = null;
        requestBody.meal_calories = null;
        requestBody.meal_protein = null;
    }

    console.log(`Sending request to backend (Mode: ${selectedMode}) with body:`, requestBody);

    try {
        // Use fetchWithAuth and the CORRECT endpoint: /generate-plan
        const response = await fetchWithAuth(`${API_BASE_URL}/generate-plan`, {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown server error generating plan.' }));
            throw new Error(`Network response was not ok: ${response.status} ${response.statusText} - ${errorData.message || errorData.error || 'Server error'}`);
        }

        const result = await response.json(); // Renamed to 'result' to avoid confusion with result.data
        console.log("Received data from backend:", result);

        // Check the 'success' flag from the backend response
        if (!result.success) {
            // Handle cases where the backend reports generation failure (e.g., can_generate: false or parsing error)
            // Use result.message or result.raw_data if available
            const errorMessage = result.message || 'Could not generate plan/meal.';
            showFeedback('meal-plan-feedback', errorMessage, 'error');
            mealPlanContentEl.innerHTML = `<p>${errorMessage}</p>`;
            if (result.raw_data) { // Display raw data if JSON parsing failed on backend
                 mealPlanContentEl.innerHTML += `<pre>Raw AI Response:\n${result.raw_data}</pre>`;
            }
            return; // Stop further processing
        }

        // --- UI Update: Display Result (using result.data which is the parsed JSON from AI) ---
        mealPlanContentEl.innerHTML = ''; // Clear loading message
        const planData = result.data; // The actual meal plan data object

        // Check if the AI indicated it could generate a plan/meal
        if (!planData || !planData.can_generate) {
             if (planData?.success === true) {
               const nutritionLine = `Calories: ${planData.calories}; Protein: ${planData.protein}g`;
               const recipeText = planData.recipe || '';
               showFeedback('meal-plan-feedback', 'Meal generated successfully!', 'success');
               mealPlanContentEl.innerHTML = `<pre>${nutritionLine}\n\n${recipeText}</pre>`;
             } else {
               const generationNote = planData?.generation_notes || planData?.meal_name || "AI indicated it could not generate a suitable plan/meal with the provided inventory/goals.";
               showFeedback('meal-plan-feedback', generationNote, 'info');
               mealPlanContentEl.innerHTML = `<p>${generationNote}</p>`;
             }
             return;
        }

        // Display based on the mode requested
        if (selectedMode === 'meal') {
            // Display single meal result
            let resultHtml = `<h4 class="meal-plan-title">${planData.meal_name || 'Generated Meal'}</h4>`;
            if (planData.estimated_calories !== null || planData.estimated_protein !== null) {
                resultHtml += `<p class="meal-plan-nutrition">`;
                if (planData.estimated_calories !== null) resultHtml += `Approx. Calories: ${planData.estimated_calories} kcal`;
                if (planData.estimated_calories !== null && planData.estimated_protein !== null) resultHtml += ` | `;
                if (planData.estimated_protein !== null) resultHtml += `Approx. Protein: ${planData.estimated_protein} g`;
                resultHtml += `</p>`;
            }
            if (planData.recipe_steps && Array.isArray(planData.recipe_steps)) {
                resultHtml += '<ul class="meal-plan-steps">';
                planData.recipe_steps.forEach(step => { resultHtml += `<li class="meal-item">${step}</li>`; });
                resultHtml += '</ul>';
            } else {
                resultHtml += '<p>No recipe steps provided.</p>';
            }
            mealPlanContentEl.innerHTML = resultHtml;
            showFeedback('meal-plan-feedback', 'Meal idea generated!', 'success');

        } else if (selectedMode === 'daily') {
            // Display buttons for daily plan
            mealPlanContentEl.innerHTML = `<h4 class="meal-plan-title">Generated Daily Plan</h4>`;
            if (planData.generation_notes) { // Display notes if provided
                mealPlanContentEl.innerHTML += `<p><i>Note: ${planData.generation_notes}</i></p>`;
            }
            const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack1', 'snack2'];
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'daily-plan-buttons'; // Add class for styling

            let planDataForStorage = {}; // Object to store data for recipe page

            mealTypes.forEach(mealKey => {
                const meal = planData[mealKey]; // Access meals directly from planData
                if (meal && meal.meal_name) {
                    const button = document.createElement('button');
                    // Display name and basic nutrition on button if available
                    let buttonText = `${mealKey.charAt(0).toUpperCase() + mealKey.slice(1)}: ${meal.meal_name}`;
                    if (meal.estimated_calories || meal.estimated_protein) {
                        buttonText += ` (~${meal.estimated_calories || '?'}kcal / ${meal.estimated_protein || '?'}g P)`;
                    }
                    button.textContent = buttonText;
                    button.classList.add('submit-button', 'meal-plan-button'); // Style as needed
                    button.dataset.mealKey = mealKey; // Store key to identify meal

                    // Store meal data for the recipe page using sessionStorage
                    const storageKey = `mealData_${mealKey}`;
                    planDataForStorage[storageKey] = meal; // Add to temporary object

                    button.addEventListener('click', (e) => {
                        const key = e.target.dataset.mealKey;
                        const mealStorageKey = `mealData_${key}`;
                        // Store the specific meal's data before navigating
                        sessionStorage.setItem('currentRecipeData', JSON.stringify(planDataForStorage[mealStorageKey]));
                        window.location.href = 'recipe.html'; // Navigate to recipe page
                    });
                    buttonContainer.appendChild(button);
                } else {
                     // Optionally indicate if a meal slot couldn't be filled
                     console.log(`No meal generated for ${mealKey}`);
                }
            });

            if (buttonContainer.children.length > 0) {
                mealPlanContentEl.appendChild(buttonContainer);
                showFeedback('meal-plan-feedback', 'Daily plan generated! Click a meal to view details.', 'success');
            } else {
                 mealPlanContentEl.innerHTML += '<p>Could not generate any meals for the daily plan.</p>';
                 showFeedback('meal-plan-feedback', 'Could not generate any meals for the daily plan.', 'error');
            }
        }

    } catch (error) {
        console.error("Error generating meal plan:", error);
        showFeedback('meal-plan-feedback', `Error: ${error.message}`, 'error');
        mealPlanContentEl.innerHTML = `<p>Error generating plan: ${error.message}</p>`;
    } finally {
        generateBtn.disabled = false; // Re-enable button
    }
}

function attachStaticListeners() {
    console.log("FUNC: attachStaticListeners");
    // Utility to avoid repeating code
    const attach = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, handler);
            console.log(`--> Attached ${event} to #${id}`);
        } else {
            console.warn(`attachStaticListeners: Missing element #${id}`);
        }
    };

    attach('edit-goals-btn', 'click', showGoalsForm);
    attach('cancel-goals-btn', 'click', hideGoalsForm);
    attach('goals-form', 'submit', handleSaveGoals);
    attach('add-inventory-form', 'submit', handleInventorySubmit);
    attach('generate-plan-btn', 'click', handleGeneratePlan);
    attach('logout-button', 'click', handleLogout);

    // Attach mode change listener
    const modeRadios = document.querySelectorAll('input[name="generation-mode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', handleModeChange);
    });

    console.log("attachStaticListeners finished");
}

function initializeDashboard() {
    console.log("FUNC: initializeDashboard");
    attachStaticListeners(); // Attach listeners for static elements first
    loadData(); // Load user data and render the dashboard
    handleModeChange(); // Initialize the mode
    // Listener for image upload button is attached separately now
    console.log("initializeDashboard finished");
}

// --- Image Upload Functionality ---
function setupImageUploadListener() {
    console.log("FUNC: setupImageUploadListener");
    // Use correct IDs from dashboard.html
    const imageInput = document.getElementById('food-image-upload');
    const uploadBtn = document.getElementById('upload-image-btn');
    const uploadStatusEl = document.getElementById('upload-status');
    const recognizedItemsListEl = document.getElementById('recognized-items-list');

    if (!imageInput || !uploadBtn || !uploadStatusEl || !recognizedItemsListEl) {
        console.error("Image upload elements missing! Cannot set up listener.");
        return;
    }

    uploadBtn.addEventListener('click', async () => {
        const file = imageInput.files[0];
        if (!file) {
            uploadStatusEl.textContent = "Please select an image file first.";
            uploadStatusEl.className = 'feedback-message error visible'; // Show error
            return;
        }

        // Basic MIME type check on client-side for quick feedback
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedMimeTypes.includes(file.type)) {
            uploadStatusEl.textContent = 'Invalid file type. Please upload JPEG, PNG, WEBP, or GIF.';
            uploadStatusEl.className = 'feedback-message error visible';
            imageInput.value = ''; // Clear the invalid file selection
            return;
        }


        // --- UI Update: Show Loading State ---
        uploadStatusEl.textContent = "Uploading and analyzing image...";
        uploadStatusEl.className = 'feedback-message info visible'; // Show info
        uploadBtn.disabled = true;
        recognizedItemsListEl.innerHTML = ''; // Clear previous results

        // --- Backend Communication ---
        try {
            const formData = new FormData();
            // Use the key expected by the backend ('foodImage')
            formData.append('foodImage', file);

            // Use fetchWithAuth for authenticated endpoint
            const response = await fetchWithAuth(`${API_BASE_URL}/user/inventory/image`, {
                method: 'POST',
                body: formData,
                // fetchWithAuth handles Authorization header
                // Content-Type is set automatically for FormData, but needs to be undefined here
                // so the browser sets the correct boundary
                headers: {
                    'Content-Type': undefined
                }
            });

            // Check response status
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: 'Unknown server error during image scan.' }));
                throw new Error(`Image scan failed: ${response.status} ${response.statusText} - ${errorData.message || 'Server error'}`);
            }

            const data = await response.json();
            console.log("Image scan result:", data);

            // Use the correct response key: recognizedItems
            if (data.success && Array.isArray(data.recognizedItems)) {
                if (data.recognizedItems.length > 0) {
                    uploadStatusEl.textContent = "Analysis complete. Click items below to add to your inventory form.";
                    uploadStatusEl.className = 'feedback-message success visible';
                    displayRecognizedItems(data.recognizedItems); // Call function to display items
                } else {
                    uploadStatusEl.textContent = "Analysis complete, but no distinct food items were recognized in the image.";
                     uploadStatusEl.className = 'feedback-message info visible';
                }
            } else {
                // Handle backend reporting success: false or unexpected format
                uploadStatusEl.textContent = data.message || "No items recognized or error processing image.";
                uploadStatusEl.className = 'feedback-message error visible';
            }

        } catch (error) {
            console.error("Error scanning image:", error);
            uploadStatusEl.textContent = `Error: ${error.message}`;
            uploadStatusEl.className = 'feedback-message error visible';
        } finally {
            // --- UI Update: End Loading State ---
            uploadBtn.disabled = false;
            imageInput.value = ''; // Clear the file input after processing
        }
    });
    console.log("--> Image upload listener attached.");
}

// --- Function to display recognized items and allow adding ---
function displayRecognizedItems(items) {
    const listEl = document.getElementById('recognized-items-list');
    const nameInput = document.getElementById('item-name'); // Target inventory form input
    listEl.innerHTML = ''; // Clear previous

    if (!items || items.length === 0) {
        listEl.innerHTML = '<li>No items recognized.</li>';
        return;
    }

    items.forEach(itemName => {
        const li = document.createElement('li');
        li.className = 'recognized-item'; // Add class for styling

        const nameSpan = document.createElement('span');
        nameSpan.textContent = itemName;
        li.appendChild(nameSpan);

        const addButton = document.createElement('button');
        addButton.textContent = 'Add';
        addButton.classList.add('add-button', 'small-button'); // Style as needed
        addButton.title = `Click to add '${itemName}' to your inventory form`;
        addButton.addEventListener('click', () => {
            // Populate the main inventory form with the clicked item name
            nameInput.value = itemName;
            document.getElementById('item-quantity').value = ''; // Clear quantity
            resetInventoryForm(); // Ensure form is in 'Add' mode
            nameInput.focus(); // Focus on the name input for potential edits/quantity add
            // Optionally remove the item from the recognized list once clicked
            // li.remove();
            // Or provide feedback
            showFeedback('inventory-feedback', `'${itemName}' copied to form. Add quantity if needed and click 'Add Item'.`, 'info', 5000);
        });
        li.appendChild(addButton);

        listEl.appendChild(li);
    });
}


// --- Event Listener Setup ---
document.addEventListener('DOMContentLoaded', () => {
    initializeDashboard();
    setupImageUploadListener(); // Set up the listener after the DOM is ready
});
