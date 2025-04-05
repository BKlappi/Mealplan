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

 // Updated function to call the backend API
 async function handleGeneratePlan() {
     console.log("HANDLER: handleGeneratePlan");
     const mealPlanContentEl = document.getElementById('meal-plan-content');
     const mealTypeSelectEl = document.getElementById('meal-type-select');
     const generateBtn = document.getElementById('generate-plan-btn');

     if (!mealPlanContentEl || !mealTypeSelectEl || !generateBtn) {
         console.error("Generate plan elements missing!");
         return;
     }

     const selectedMealType = mealTypeSelectEl.value;
     // Ensure goals and inventory are loaded (they should be by loadData)
     const goalsToSend = currentGoals;
     const inventoryToSend = currentInventory;

     // --- UI Update: Show Loading State ---
     mealPlanContentEl.innerHTML = '<p><i>Generating meal idea...</i></p>';
     generateBtn.disabled = true; // Disable button while loading
     hideFeedback('meal-plan-feedback'); // Assuming a feedback element exists or will be added

     try {
         console.log(`Sending request to backend for ${selectedMealType}...`);
         const response = await fetch('https://mealplan-backend-9d1p.onrender.com/api/generate-meal', { // Use Render URL
             method: 'POST',
             headers: {
                 'Content-Type': 'application/json',
             },
             body: JSON.stringify({
                 meal_type: selectedMealType,
                 goals: goalsToSend,
                 inventory_list: inventoryToSend
             }),
         });

         if (!response.ok) {
             // Handle HTTP errors (e.g., 404, 500)
             const errorText = await response.text();
             throw new Error(`Network response was not ok: ${response.status} ${response.statusText} - ${errorText}`);
         }

         const data = await response.json();
         console.log("Received data from backend:", data);

         // --- UI Update: Display Result ---
         let resultHtml = `<h4 class="meal-plan-title">${data.meal_name || 'Generated Meal'}</h4>`;
         if (data.recipe_steps && Array.isArray(data.recipe_steps)) {
             resultHtml += '<ul>';
             data.recipe_steps.forEach(step => {
                 resultHtml += `<li class="meal-item">${step}</li>`; // Use meal-item class for potential styling
             });
             resultHtml += '</ul>';
         } else {
             resultHtml += '<p>No recipe steps provided.</p>';
         }
         mealPlanContentEl.innerHTML = resultHtml;
         // Optional: Show success feedback
         // showFeedback('meal-plan-feedback', 'Meal idea generated!', 'success');

     } catch (error) {
         console.error('Error generating meal plan:', error);
         // --- UI Update: Display Error ---
         mealPlanContentEl.innerHTML = `<p style="color: var(--danger-color);">Error generating meal idea. Please try again later.</p>`;
         // Optional: Show error feedback
         // showFeedback('meal-plan-feedback', 'Error generating meal.', 'error');
     } finally {
         // --- UI Update: Reset Loading State ---
         generateBtn.disabled = false; // Re-enable button
         console.log("--> Meal plan generation attempt finished.");
     }
 }


// --- Attach Static Listeners (Once on Init) ---
 function attachStaticListeners() {
     console.log("Attaching Static Listeners...");
     let success = true; const attach = (id, event, handler) => { const el=document.getElementById(id); if(el && !el.listenerAttached){ el.addEventListener(event, handler); el.listenerAttached=true; console.log(`Listener Attached: ${event} on #${id}`);} else if(!el){console.warn(`Attach Fail #${id}`); success=false;} else {console.log(`Listener Already Attached: ${event} on #${id}`);}};
     attach('edit-goals-btn', 'click', showGoalsForm); attach('cancel-goals-btn', 'click', hideGoalsForm); attach('goals-form', 'submit', handleSaveGoals); attach('add-inventory-form', 'submit', handleInventorySubmit); attach('logout-button', 'click', handleLogout); attach('generate-plan-btn', 'click', handleGeneratePlan);
     // Removed listener attachment for '.close-view-btn'
     console.log(`Static Listener Attachment finished. Success: ${success}`);
     return success; // Return success status
 }

// --- Initialize ---
function initializeDashboard() {
    console.log(">>> Initializing Dashboard...");
    const email = localStorage.getItem(LOGGED_IN_USER_KEY); if (!email) { window.location.href = 'login.html'; return; } console.log("User logged in.");
    const listenersOk = attachStaticListeners(); // Attach listeners FIRST
    if (listenersOk) {
        loadData(); // Load data ONLY if listeners attached ok (prevents errors if buttons missing)
    } else {
        console.error("Initialization FAILED: Could not attach all static listeners!");
         showFeedback('goals-feedback', 'Error initializing page buttons.', 'error', 0); // Persistent error message
    }
    console.log(">>> Dashboard Initialization Complete <<<");
}

// --- START ---
initializeDashboard();
