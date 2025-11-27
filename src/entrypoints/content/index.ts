import { bootstrapFeatures } from "../../core/feature-registry";

export default defineContentScript({
  matches: ["https://github.com/*", "https://gist.github.com/*"],
  runAt: "document_idle",

  main() {
    async function initOnce() {
      await bootstrapFeatures(document, window.location);
    }

    let lastUrl = location.href;

    function watchUrlChanges() {
      const observer = new MutationObserver(() => {
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          setTimeout(() => {
            bootstrapFeatures(document, window.location).catch((err) => {
              console.error("[GitHub Enhancement Suite] bootstrap error after URL change", err);
            });
          }, 150);
        }
      });

      observer.observe(document, { subtree: true, childList: true });
    }

    initOnce().catch((err) =>
      console.error("[GitHub Enhancement Suite] initial bootstrap error", err),
    );
    watchUrlChanges();
  },
});
