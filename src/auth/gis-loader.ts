const DEFAULT_GIS_URL = 'https://accounts.google.com/gsi/client';

export const GisLoader = (() => {
  let loadPromise: Promise<void> | null = null;

  function load(scriptUrl = DEFAULT_GIS_URL): Promise<void> {
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      return Promise.resolve();
    }
    if (!loadPromise) {
      loadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load GIS script: ${scriptUrl}`));
        document.head.appendChild(script);
      });
    }
    return loadPromise;
  }

  return { load };
})();
