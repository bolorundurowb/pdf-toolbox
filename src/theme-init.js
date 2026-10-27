/* Applies the saved theme before Angular paints, avoiding a white flash. */
(function () {
  try {
    var raw = localStorage.getItem('pdf-toolbox.settings');
    if (!raw) return;
    var theme = JSON.parse(raw).theme;
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {
    /* A malformed or unavailable store just means the system theme is used. */
  }
})();
