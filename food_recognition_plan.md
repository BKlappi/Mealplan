# Food Recognition Feature Plan

## Goal
Implement a feature that allows users to upload images of their food storage, have the AI recognize the food items, and automatically update their inventory.

## 1. Frontend
*   Modify the existing inventory management section in `dashboard.html` and `dashboard.js` to include an image upload component.
*   Before accessing the camera, ask for permission to use the user's phone camera.
*   If the user is on a laptop, suggest they switch to their phone for this step.
*   Implement the image upload functionality using JavaScript. The image will be sent to a new backend API endpoint.
*   Display a progress bar and status messages to provide feedback to the user during the image analysis process.
*   Display the list of recognized food items with editable fields (e.g., text boxes for quantity and units). This list will be populated by the backend API.
*   Allow the user to edit the recognized items and submit the updated inventory to the backend.

## 2. Backend
*   Create a new API endpoint `/api/user/inventory/image` to receive the image and inventory data. This endpoint will:
    *   Receive the image from the frontend.
    *   Call the Gemini 1.5 Flash API to analyze the image and recognize food items.
    *   Process the API response to extract the food items.
    *   Return the list of recognized food items to the frontend, along with progress updates and status messages.
    *   Update the inventory database with the new items and quantities based on user edits.
    *   Discard the image after analysis.
*   Reuse the existing API endpoints (`POST`, `PUT`, `DELETE`) to manage the inventory.

## 3. Gemini 1.5 Flash Integration
*   Reuse the existing Gemini API client (`genAI` and `geminiModel`).
*   Create a new function to send the image to the API for analysis and parse the response.

## 4. Database
*   The existing `user_inventory` table should be sufficient.

## 5. User Interface
*   Update the dashboard to display the updated inventory.
*   Provide feedback to the user on the progress of the image analysis and inventory update.