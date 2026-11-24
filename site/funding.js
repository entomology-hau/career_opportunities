'use strict';

(() => {
  const themeButton = document.getElementById('theme-toggle');
  const themeLabel = document.getElementById('theme-label');
  const themeColour = document.querySelector('meta[name="theme-color"]');

  function applyTheme(theme) {
    const dark = theme === 'dark';
    document.documentElement.dataset.theme = theme;
    themeButton.setAttribute('aria-pressed', String(dark));
    themeButton.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    themeLabel.textContent = dark ? 'Light mode' : 'Dark mode';
    themeColour.content = dark ? '#253750' : '#eaf1fa';
  }

  let initialTheme = 'light';
  try {
    if (localStorage.getItem('entomology-theme') === 'dark') initialTheme = 'dark';
  } catch {}
  applyTheme(initialTheme);
  themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('entomology-theme', theme); } catch {}
  });

  const rounds = [...document.querySelectorAll('.funding-round')].map(round => {
    const status = round.querySelector('[data-round-status]');
    return {round, status, initialText: status.textContent};
  });
  const londonDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  });

  function refreshRounds() {
    const now = Date.now();
    const parts = Object.fromEntries(londonDate.formatToParts(now).map(part => [part.type, part.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;

    for (const {round, status, initialText} of rounds) {
      const opensAt = Date.parse(round.dataset.opensAt);
      const closesAt = Date.parse(round.dataset.closesAt);
      const closesOn = round.dataset.closesOn;
      const validClosingDate = /^\d{4}-\d{2}-\d{2}$/.test(closesOn || '') &&
        Number.isFinite(Date.parse(closesOn)) &&
        new Date(closesOn).toISOString().slice(0, 10) === closesOn;

      let text = initialText;
      if (now >= closesAt || (validClosingDate && today > closesOn)) {
        text = 'Listed round closed · check next round';
      } else if (now >= opensAt && now < closesAt) {
        text = 'Application window open';
      }
      status.textContent = text;
    }
  }

  refreshRounds();
  setInterval(refreshRounds, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshRounds();
  });
})();
