// Web: the document title of a page.

/** Sets the browser tab title while a page is shown; returns a function that puts the old title back. */
export function setTitle(title: string): () => void {
  const old = document.title;
  document.title = title;
  return () => {
    document.title = old;
  };
}

/** Adds the theme's colour variables to the page (once). Called before the first render. */
export function installTheme(css: string) {
  if (document.getElementById('ce-theme')) return;
  const style = document.createElement('style');
  style.id = 'ce-theme';
  style.textContent = css;
  document.head.appendChild(style);
}
