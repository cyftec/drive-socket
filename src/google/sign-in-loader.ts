import { GSI_CLIENT_URL } from "./utils";

let loadPromise: Promise<void> | null = null;

export function loadGoogleSignIn(): Promise<void> {
  if (typeof google !== "undefined" && google.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_CLIENT_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          new Error(`Failed to load Google Sign-In script: ${GSI_CLIENT_URL}`),
        );
      document.head.appendChild(script);
    });
  }
  return loadPromise;
}
