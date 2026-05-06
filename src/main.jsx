import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "idk-ui/theme.css";
import "idk-ui/motion.css";
import "./index.css";
import App from "./App.jsx";
import { registerServiceWorker } from "./pwa";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
