const AppTabs = (() => {
  const buttons = Array.from(document.querySelectorAll("[data-view-button]"));
  const recordingView = document.querySelector("#recording-view");
  let activeView = "signals";

  const setView = (view, updateLocation = true) => {
    if (view !== "signals" && view !== "record") return;
    activeView = view;
    if (updateLocation && window.location.hash !== `#${view}`) {
      window.history.replaceState(null, "", `#${view}`);
    }
    document.body.dataset.view = view;
    recordingView.hidden = view !== "record";
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
    setView(window.location.hash === "#record" ? "record" : "signals", false);
  });

  setView(window.location.hash === "#record" ? "record" : "signals", false);

  return {
    getActiveView: () => activeView,
    setView,
  };
})();
