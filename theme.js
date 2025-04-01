// --- theme.js ---

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleButton = document.getElementById('theme-toggle-button');
    const bodyElement = document.body;
    const themeStorageKey = 'themePreference'; // Key to store theme in localStorage

    // --- Function to Apply Theme ---
    // Takes 'light' or 'dark' as argument
    const applyTheme = (theme) => {
        if (theme === 'light') {
            bodyElement.classList.add('light-mode');
            if (themeToggleButton) themeToggleButton.textContent = '🌙'; // Moon icon for light mode
            localStorage.setItem(themeStorageKey, 'light');
        } else {
            // Default to dark mode if theme is not 'light'
            bodyElement.classList.remove('light-mode');
            if (themeToggleButton) themeToggleButton.textContent = '☀️'; // Sun icon for dark mode
            localStorage.setItem(themeStorageKey, 'dark');
        }
    };

    // --- Load Theme on Page Load ---
    const savedTheme = localStorage.getItem(themeStorageKey);

    // Check saved theme preference first
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        // Optional: Check system preference if no preference is saved
        // const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        // applyTheme(prefersDark ? 'dark' : 'light');

        // Or simply default to dark mode (as per initial CSS) if no preference
         applyTheme('dark');
    }


    // --- Add Event Listener to Button ---
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => {
            // Check current mode by looking for the class on body
            const isLightMode = bodyElement.classList.contains('light-mode');
            // Toggle to the opposite theme
            applyTheme(isLightMode ? 'dark' : 'light');
        });
    } else {
        console.warn('Theme toggle button not found on this page.');
    }
});