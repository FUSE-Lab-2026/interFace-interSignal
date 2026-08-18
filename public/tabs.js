const AppTabs = (() => {
  const buttons = Array.from(document.querySelectorAll("[data-view-button]"));
  const views = {
    record: document.querySelector("#recording-view"),
    playback: document.querySelector("#playback-view"),
  };
  const validViews = new Set(["signals", ...Object.keys(views)]);
  let activeView = "signals";

  const viewFromHash = () => {
    const view = window.location.hash.slice(1);
    return validViews.has(view) ? view : "signals";
  };

  const setView = (view, updateLocation = true) => {
    if (!validViews.has(view)) return;
    activeView = view;
    if (updateLocation && window.location.hash !== `#${view}`) {
      window.history.replaceState(null, "", `#${view}`);
    }
    document.body.dataset.view = view;
    for (const [viewName, element] of Object.entries(views)) {
      element.hidden = view !== viewName;
    }
    for (const button of buttons) {
      const active = button.dataset.viewButton === view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    window.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent("appviewchange", { detail: { view } }));
  };

  for (const button of buttons) {
    button.addEventListener("click", () => setView(button.dataset.viewButton));
  }

  window.addEventListener("hashchange", () => {
    setView(viewFromHash(), false);
  });

  setView(viewFromHash(), false);

  return {
    getActiveView: () => activeView,
    setView,
  };
})();
