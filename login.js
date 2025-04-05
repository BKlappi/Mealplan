// login.js (Updated showError/hideError to use CSS classes)

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorDiv = document.getElementById('login-error'); // Targets the error message div

    // --- Local Storage Keys ---
    const USERS_STORAGE_KEY = 'registeredUsers';
    // --- Local Storage Keys (Retained for storing login status) ---
    const LOGGED_IN_USER_KEY = 'loggedInUserEmail';
    const LOGGED_IN_USERNAME_KEY = 'loggedInUsername';

    loginForm.addEventListener('submit', async (event) => { // Make async
        event.preventDefault();
        hideError(); // Hide previous error on new submit

        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        if (!email || !password) {
            showError('Please enter both email and password.');
            return;
        }

        // --- Call Backend API ---
        try {
            const response = await fetch('https://mealplan-backend-9d1p.onrender.com/api/login', { // Use Render URL
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (response.ok && data.success && data.token) { // Check for token as well
                // Login Successful
                console.log("Login successful, storing user info and token:", { email, username: data.username });
                localStorage.setItem(LOGGED_IN_USER_KEY, email); // Still useful for some checks? Maybe remove later.
                localStorage.setItem(LOGGED_IN_USERNAME_KEY, data.username); // Store username received from backend
                localStorage.setItem('authToken', data.token); // Store the JWT
                window.location.href = 'dashboard.html'; // Redirect to dashboard
            } else {
                // Login Failed (Invalid credentials, missing token, or other server error)
                showError(data.message || 'Login failed. Please try again.'); // Show backend message or generic one
                passwordInput.value = ''; // Clear password field
                passwordInput.focus();
                // Clear potential lingering login keys on failed attempt
                localStorage.removeItem(LOGGED_IN_USER_KEY);
                localStorage.removeItem(LOGGED_IN_USERNAME_KEY);
            }

        } catch (error) {
            // Handle network errors or other issues with the fetch call
            console.error('Login fetch error:', error);
            showError('An error occurred during login. Please check your connection and try again.');
            // Clear potential lingering login keys on network error
            localStorage.removeItem(LOGGED_IN_USER_KEY);
            localStorage.removeItem(LOGGED_IN_USERNAME_KEY);
        }
    });

    // Updated Feedback Display Functions
    function showError(message) { // Keep name, but use new classes
        if (errorDiv) {
            errorDiv.textContent = message;
            // Ensure base class is present, add error and visible
            errorDiv.className = 'feedback-message error visible';
        }
    }

    function hideError() { // Keep name, but use new classes
         if (errorDiv) {
             errorDiv.textContent = '';
             // Remove visible and specific type, keep base class
             errorDiv.className = 'feedback-message';
         }
    }
});
