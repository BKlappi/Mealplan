document.addEventListener('DOMContentLoaded', () => {
    const registrationForm = document.getElementById('registration-form');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const passwordConfirmInput = document.getElementById('password_confirm');
    const feedbackDiv = document.getElementById('register-error'); // Get the feedback div

    // Function to display feedback messages
    function showFeedback(message, isError = true) {
        if (!feedbackDiv) return;
        feedbackDiv.textContent = message;
        feedbackDiv.className = isError ? 'error-message visible' : 'feedback success visible'; // Use appropriate classes
        // Note: You might need to add 'feedback', 'success', 'visible' classes to your CSS if not already present
        // For now, reusing 'error-message' and adding 'visible'
    }

    // Function to hide feedback
    function hideFeedback() {
        if (!feedbackDiv) return;
        feedbackDiv.textContent = '';
        feedbackDiv.className = 'error-message'; // Hide it
    }


    registrationForm.addEventListener('submit', async (event) => { // Make async for await
        event.preventDefault(); // Prevent default form submission
        hideFeedback(); // Clear previous feedback

        const username = usernameInput.value.trim();
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        const passwordConfirm = passwordConfirmInput.value;

        // --- Basic Client-Side Validation ---
        if (!username || !email || !password || !passwordConfirm) {
            showFeedback('Please fill in all fields.');
            return;
        }

        if (password !== passwordConfirm) {
            showFeedback('Passwords do not match.');
            passwordInput.value = ''; // Clear password fields
            passwordConfirmInput.value = '';
            passwordInput.focus();
            return;
        }

        // --- Call Backend API ---
        try {
            const response = await fetch('https://mealplan-backend-9d1p.onrender.com/api/register', { // Use Render URL
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, email, password }),
            });

            const data = await response.json();

            if (response.ok && data.success) { // Check for success status (e.g., 201 Created) and success flag
                // Registration successful
                // Show success message briefly before redirecting
                showFeedback('Registration successful! Redirecting to login...', false); // false indicates not an error
                setTimeout(() => {
                    window.location.href = 'login.html'; // Redirect to login page
                }, 1500); // Wait 1.5 seconds
            } else {
                // Handle errors reported by the backend (e.g., duplicate user, validation errors)
                showFeedback(data.message || 'Registration failed. Please try again.'); // Show backend message or generic one
            }

        } catch (error) {
            // Handle network errors or other issues with the fetch call
            console.error('Registration fetch error:', error);
            showFeedback('An error occurred during registration. Please check your connection and try again.');
        }
    });
});
