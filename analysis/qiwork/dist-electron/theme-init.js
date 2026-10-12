/**
 * FOUC guard — must stay in sync with src/styles/themeInit.ts
 * Loaded from index.html before the app bundle.
 */
(function () {
  var STORAGE_KEY = "qiwork-theme";
  try {
    var mode = localStorage.getItem(STORAGE_KEY);
    var dark =
      mode === "dark" ||
      (mode !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark-mode");
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {
    // ignore
  }
})();
