import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
// The production build removes this branch and the fixture module.
const demo = __DEMO__ ? await import("./demo") : undefined;
createRoot(document.getElementById("root")!).render(
  <App config={demo?.DEMO_CONFIG ?? __APP_CONFIG__} demo={demo} />,
);
