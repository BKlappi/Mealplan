document.addEventListener('DOMContentLoaded', () => {
    const recipeNameEl = document.getElementById('recipe-name');
    const recipeNutritionEl = document.getElementById('recipe-nutrition');
    const recipeStepsEl = document.getElementById('recipe-steps');

    // Retrieve data from sessionStorage
    const recipeData = JSON.parse(sessionStorage.getItem('currentRecipeData'));

    if (recipeData) {
        // Update recipe name
        recipeNameEl.textContent = recipeData.meal_name || 'Recipe Name';

        // Update nutrition information
        let nutritionText = '';
        if (recipeData.estimated_calories !== null) {
            nutritionText += `Calories: ${recipeData.estimated_calories} kcal`;
        }
        if (recipeData.estimated_protein !== null) {
            nutritionText += nutritionText ? ` | Protein: ${recipeData.estimated_protein} g` : `Protein: ${recipeData.estimated_protein} g`;
        }
        recipeNutritionEl.textContent = nutritionText || 'No nutrition info available';

        // Update recipe steps
        recipeStepsEl.innerHTML = '';
        if (recipeData.recipe_steps && Array.isArray(recipeData.recipe_steps)) {
            recipeData.recipe_steps.forEach(step => {
                const li = document.createElement('li');
                li.textContent = step;
                recipeStepsEl.appendChild(li);
            });
        } else {
            recipeStepsEl.textContent = 'No recipe steps provided.';
        }
    } else {
        recipeNameEl.textContent = 'No recipe data found';
    }
});
