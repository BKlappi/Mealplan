// --- Keys & State ---
const LOGGED_IN_USER_KEY = 'loggedInUserEmail';
const LOGGED_IN_USERNAME_KEY = 'loggedInUsername';
const GOALS_STORAGE_KEY = 'userGoals';
const INVENTORY_STORAGE_KEY = 'userInventory';
let currentGoals = {};
let currentInventory = [];
const defaultGoals = { calories: 2500, protein: 150 };
const defaultInventory = [ { name: 'Example Bread', quantity: '1 loaf' } ];
let editingInventoryIndex = null; // null means adding, number means editing index

// --- Helper Functions ---
function showFeedback(elementId, message, type = 'info', duration = 4000) { // Added duration back
    const element = document.getElementById(elementId);
    if (!element) { console.warn("showFeedback: target missing", elementId); return; }
    if (element.feedbackTimeout) { clearTimeout(element.feedbackTimeout); } // Clear previous timeout
    element.textContent = message;
    element.className = `feedback ${type}`; // Use template literal or specific class adds
    element.classList.remove('hidden');
    // Optional: Auto-hide after duration
    if (duration > 0) {
         element.feedbackTimeout = setTimeout(() => { element.classList.add('hidden'); element.textContent = ''; }, duration);
    }
}
function hideFeedback(elementId) {
     const element = document.getElementById(elementId);
     if (element) {
         if (element.feedbackTimeout) { clearTimeout(element.feedbackTimeout); } // Clear timeout if hiding manually
         element.classList.add('hidden');
         element.textContent = '';
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

// *** CORRECTED loadData Function ***
function loadData() {
    console.log("FUNC: loadData");
    try {
         currentGoals = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY) || JSON.stringify(defaultGoals));
         currentInventory = JSON.parse(localStorage.getItem(INVENTORY_STORAGE_KEY) || JSON.stringify(defaultInventory));
         // Ensure inventory is an array after parsing
         if (!Array.isArray(currentInventory)) {
             console.warn("Parsed inventory was not an array, resetting to empty.");
             currentInventory = []; // Default to empty array if parse fails or gives non-array
             localStorage.setItem(INVENTORY_STORAGE_KEY,'[]'); // Save the empty array back
         } // *** REMOVED STRAY SEMICOLON THAT WAS HERE ***
         console.log("--> Data loaded from storage:", { currentGoals, currentInventory });
         // Trigger UI updates AFTER data is confirmed loaded
         displayGoals();
         displayInventory();
         displayUserGreeting();
    } catch (e) {
         console.error("loadData failed", e);
         // Attempt to load defaults if error occurs
         currentGoals = { ...defaultGoals };
         currentInventory = [...defaultInventory]; // Use spread to ensure fresh copy
         displayGoals(); displayInventory(); displayUserGreeting(); // Try to display defaults
         showFeedback('goals-feedback', 'Error loading saved data.', 'error'); // Show feedback maybe?
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
function handleSaveGoals(event) {
     console.log("HANDLER: handleSaveGoals"); event.preventDefault(); const calIn=document.getElementById('edit-calories'); const protIn=document.getElementById('edit-protein'); hideFeedback('goals-feedback'); if(!calIn||!protIn)return; const newC=parseInt(calIn.value); const newP=parseInt(protIn.value);
     if(isNaN(newC)||isNaN(newP)||newC<=0||newP<=0){showFeedback('goals-feedback','Positive numbers needed','error'); return;}
     currentGoals={calories: newC, protein: newP}; localStorage.setItem(GOALS_STORAGE_KEY,JSON.stringify(currentGoals)); console.log("Goals saved", currentGoals); displayGoals(); hideGoalsForm(); showFeedback('goals-feedback','Goals Saved!','success');
 }
function handleStartEditItem(event) {
     console.log("HANDLER: handleStartEditItem"); const index=parseInt(event.target.dataset.index); const item=currentInventory[index]; const nameIn=document.getElementById('item-name'); const quantIn=document.getElementById('item-quantity'); const submitBtn=document.getElementById('add-update-inventory-btn'); if(isNaN(index)||!item||!nameIn||!quantIn||!submitBtn){console.error("Start Edit Err"); return;} editingInventoryIndex=index; nameIn.value=item.name; quantIn.value=item.quantity||''; submitBtn.textContent='Update Item'; submitBtn.classList.add('update-mode'); nameIn.focus(); hideFeedback('inventory-feedback'); console.log("--> Edit form populated.");
 }
function handleInventorySubmit(event) {
     console.log("HANDLER: handleInventorySubmit"); event.preventDefault(); const nameIn=document.getElementById('item-name'); const quantIn=document.getElementById('item-quantity'); const formEl=document.getElementById('add-inventory-form'); hideFeedback('inventory-feedback'); if(!nameIn||!quantIn||!formEl)return; const name=nameIn.value.trim(); const quantity=quantIn.value.trim(); if(!name){showFeedback('inventory-feedback','Name needed','error'); return;} console.log("Inv Submit: editing=", editingInventoryIndex); console.log("Inv Before:", JSON.stringify(currentInventory));
     if(editingInventoryIndex!==null){ if(editingInventoryIndex>=0&&editingInventoryIndex<currentInventory.length){currentInventory[editingInventoryIndex]={name,quantity};}else{console.error("Bad edit index");}} else{currentInventory.push({name,quantity});}
     console.log("Inv After:", JSON.stringify(currentInventory)); localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(currentInventory)); displayInventory(); resetInventoryForm(); showFeedback('inventory-feedback', editingInventoryIndex!==null ? 'Item Updated!':'Item Added!', 'success');
 }
function resetInventoryForm() {
     console.log("HANDLER: resetInventoryForm"); const formEl=document.getElementById('add-inventory-form'); const submitBtn=document.getElementById('add-update-inventory-btn'); if(formEl)formEl.reset(); if(submitBtn){submitBtn.textContent='Add Item'; submitBtn.classList.remove('update-mode');} editingInventoryIndex=null; hideFeedback('inventory-feedback'); console.log("--> Form reset to Add.");
 }
function handleRemoveItem(event) {
     // ADD CONFIRMATION BACK HERE - Important UX
     const indexToRemove = parseInt(event.target.dataset.index, 10); if(isNaN(indexToRemove))return; const item=currentInventory[indexToRemove]; if(!item){console.error("Remove Err: No item"); return;}
     console.log(`HANDLER: handleRemoveItem idx:${indexToRemove} Name:"${item.name}"`);
     hideFeedback('inventory-feedback');
     // Use window.confirm
     if (window.confirm(`Are you sure you want to remove "${item.name}"?`)) {
        console.log("--> User CONFIRMED remove.");
        if(editingInventoryIndex===indexToRemove){ resetInventoryForm(); } console.log("--> Inv BEFORE:",JSON.stringify(currentInventory)); const removed=currentInventory.splice(indexToRemove, 1); console.log("--> Inv AFTER:",JSON.stringify(currentInventory)); localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(currentInventory)); displayInventory(); showFeedback('inventory-feedback', `"${item.name}" Removed`, 'success');
     } else {
         console.log("--> User CANCELED remove.");
     }
 }
 function handleLogout(event) { console.log("HANDLER: handleLogout"); event.preventDefault(); localStorage.removeItem(LOGGED_IN_USER_KEY); localStorage.removeItem(LOGGED_IN_USERNAME_KEY); window.location.href = 'index.html'; }

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
