import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";
import App from "./App";
import "./index.css";
import { persistor, store } from "./redux/store";

// Disable service workers in webview contexts (VSCode, JetBrains, etc.)
// to prevent "InvalidStateError: Failed to register a ServiceWorker"
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  // Override navigator.serviceWorker.register to prevent registration
  const originalRegister = navigator.serviceWorker.register;
  navigator.serviceWorker.register = async function (
    scriptURL: string | URL,
    options?: RegistrationOptions,
  ) {
    // Check if we're in a webview context (VSCode, JetBrains)
    const isWebview =
      typeof (window as any).vscode !== "undefined" ||
      typeof (window as any).ide === "string";

    if (isWebview) {
      console.debug("Service worker registration disabled in webview context");
      return Promise.reject(
        new Error("Service workers are not supported in webview contexts"),
      );
    }
    return originalRegister.call(this, scriptURL, options);
  };
}

(async () => {
  const container = document.getElementById("root") as HTMLElement;

  // Create React root
  const root = ReactDOM.createRoot(container);

  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <App />
        </PersistGate>
      </Provider>
    </React.StrictMode>,
  );
})();
