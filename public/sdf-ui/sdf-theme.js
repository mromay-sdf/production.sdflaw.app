(function () {
  const KEY = 'sdf-theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  function stored(){ return localStorage.getItem(KEY) || 'system'; }
  function resolved(value){ return value === 'system' ? (media.matches ? 'dark' : 'light') : value; }
  function apply(value){ root.dataset.theme = resolved(value); root.dataset.themePreference = value; document.querySelectorAll('[data-sdf-theme]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sdfTheme === value))); }
  function set(value){ if(!['light','dark','system'].includes(value)) return; localStorage.setItem(KEY,value); apply(value); }
  document.addEventListener('click', e => { const b=e.target.closest('[data-sdf-theme]'); if(b) set(b.dataset.sdfTheme); });
  media.addEventListener?.('change', () => { if(stored()==='system') apply('system'); });
  apply(stored());
  window.SDFTheme = { set, get: stored };
})();
