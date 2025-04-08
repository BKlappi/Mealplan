# Plan to Fix Meal Generation AI Response

## Problem

The meal generation AI (`/api/generate-plan` endpoint with `mode: 'meal'`) is currently only returning calorie and protein estimates. It fails to provide the specific **Meal Name** and the detailed **Recipe** steps as intended.

## Analysis

- The backend code (`backend/server.js`) uses Google's Gemini AI (`gemini-1.5-flash`).
- The prompt sent to the AI (lines 246-276) explicitly requests the response format:
  ```
  Calories: [Calculated Calories]; Protein: [Calculated Protein]g
  Meal Name: [Name of the meal...]
  Recipe:
  1. Step one...
  2. Step two...
  ...
  ```
- The current backend parsing logic (lines 321-356):
  - Correctly extracts `Calories:` and `Protein:` from the first line.
  - **Incorrectly** hardcodes `meal_name` to `"Generated Meal"` (line 339).
  - **Incorrectly** assumes all text after the first line is the recipe (line 327), potentially including the `Meal Name:` line and not explicitly looking for the `Recipe:` marker.

## Hypothesis

The primary issue is likely the backend parsing logic failing to correctly extract the `Meal Name` and `Recipe` from the AI's response, even if the AI provides them in the requested format.

## Proposed Plan

1.  **Step 1: Verify AI Output**
    *   **Action:** Temporarily modify `/api/generate-plan` in `backend/server.js` to log the *exact raw text response* from the AI when `mode === 'meal'`.
    *   **Goal:** Determine if the AI includes `Meal Name:` and `Recipe:` lines.

2.  **Step 2: Analyze Raw Response**
    *   **Action:** Trigger meal generation and check server logs for the raw AI response.
    *   **Goal:** Confirm the presence and format of `Meal Name:` and `Recipe:`.

3.  **Step 3: Implement Fix**
    *   **Scenario A: AI Response is Correct:**
        *   **Action:** Modify parsing logic (lines 324-344) to:
            1.  Find and extract the text following `Meal Name:`.
            2.  Find the line starting with `Recipe:`.
            3.  Extract subsequent lines as the recipe.
            4.  Return the extracted `meal_name` and `recipe`.
    *   **Scenario B: AI Response is Incorrect:**
        *   **Action:** Refine the AI prompt (lines 246-276) for clarity and consistency. Consider adjusting AI parameters (`temperature`).
        *   **Goal:** Ensure the AI reliably generates the output in the desired format.

4.  **Step 4: Test Thoroughly**
    *   **Action:** Test the fix with various inputs (goals, inventory).
    *   **Goal:** Verify consistent and correct output (name, recipe, nutrition).

5.  **Step 5: Clean Up**
    *   **Action:** Remove temporary logging from Step 1.
    *   **Goal:** Maintain clean code.

## Plan Diagram

```mermaid
graph TD
    A[Start: Meal Gen Broken] --> B{Analyze server.js};
    B --> C{Identify Prompt & Parsing Logic};
    C --> D{Hypothesis: Parsing Error};
    D --> E[Step 1: Log Raw AI Response];
    E --> F[Step 2: Trigger Meal Gen & Check Logs];
    F --> G{AI Response Correct?};
    G -- Yes --> H[Step 3A: Fix Parsing Logic];
    G -- No --> I[Step 3B: Refine AI Prompt];
    H --> J[Step 4: Test Fix];
    I --> J;
    J --> K[Step 5: Remove Logging];
    K --> L[End: Meal Gen Fixed];