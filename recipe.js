document.addEventListener('DOMContentLoaded', () => {
    const mealNameEl = document.getElementById('recipe-meal-name');
    const nutritionEl = document.getElementById('recipe-nutrition');
    const stepsListEl = document.getElementById('recipe-steps-list');

    // Retrieve the recipe data stored by dashboard.js
    const recipeDataString = sessionStorage.getItem('currentRecipeData');
    // Clear it immediately after retrieving so it's not stale on page refresh/back
    sessionStorage.removeItem('currentRecipeData'); 

    if (!recipeDataString) {
        console.error("No recipe data found in sessionStorage.");
        mealNameEl.textContent = "Error";
        nutritionEl.textContent = "";
        stepsListEl.innerHTML = '<li>Could not load recipe details. Please go back to the dashboard and try again.</li>';
        return;
    }

    try {
        const recipeData = JSON.parse(recipeDataString);
        console.log("Loaded recipe data:", recipeData);

        // Populate the page elements
        mealNameEl.textContent = recipeData.meal_name || "Unnamed Recipe";

        // Format nutrition string
        let nutritionText = "";
        if (recipeData.estimated_calories !== null || recipeData.estimated_protein !== null) {
            if (recipeData.estimated_calories !== null) {
                nutritionText += `Approx. Calories: ${recipeData.estimated_calories} kcal`;
            }
            if (recipeData.estimated_calories !== null && recipeData.estimated_protein !== null) {
                nutritionText += ` | `; // Separator
            }
            if (recipeData.estimated_protein !== null) {
                nutritionText += `Approx. Protein: ${recipeData.estimated_protein} g`;
            }
        } else {
            nutritionText = "Nutrition information not available.";
        }
        nutritionEl.textContent = nutritionText;

        // Populate recipe steps
        stepsListEl.innerHTML = ''; // Clear loading message
        if (recipeData.recipe_steps && Array.isArray(recipeData.recipe_steps) && recipeData.recipe_steps.length > 0) {
            recipeData.recipe_steps.forEach(step => {
                const li = document.createElement('li');
                li.textContent = step;
                stepsListEl.appendChild(li);
            });
        } else {
            stepsListEl.innerHTML = '<li>No recipe steps provided.</li>';
        }

    } catch (error) {
        console.error("Error parsing recipe data:", error);
        mealNameEl.textContent = "Error";
        nutritionEl.textContent = "";
        stepsListEl.innerHTML = '<li>Could not load recipe details due to an error.</li>';
    }
});
