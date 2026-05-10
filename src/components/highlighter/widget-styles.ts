import { paletteCss } from "./colors.ts";

export function injectGlobalStyles(): void {
  const id = "octobase-highlighter-styles";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.innerHTML = paletteCss();
  document.head.appendChild(style);
}
