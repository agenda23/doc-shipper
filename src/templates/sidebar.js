(function () {
  "use strict";

  var STORAGE_KEY = "doc-shipper-sidebar-state";
  var THEME_KEY = "doc-shipper-theme";

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore (private mode 等) */
    }
  }

  function normalizePath(p) {
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  }

  function initCurrentHighlightAndAncestors() {
    var current = normalizePath(location.pathname);
    var ancestors = [];
    document.querySelectorAll(".tree-link").forEach(function (link) {
      var href = link.getAttribute("href");
      if (!href || normalizePath(href) !== current) return;
      var node = link.closest(".tree-node");
      if (node) node.classList.add("is-current");
      var el = node && node.parentElement;
      while (el) {
        var ancestorNode = el.closest(".tree-node");
        if (!ancestorNode) break;
        ancestors.push(ancestorNode);
        el = ancestorNode.parentElement;
      }
    });
    return ancestors;
  }

  function initAccordion(alwaysExpanded) {
    var state = readState();
    var nodes = document.querySelectorAll(".tree-node");

    nodes.forEach(function (node) {
      var key = node.getAttribute("data-key");
      var toggle = node.querySelector(":scope > .tree-row > .tree-toggle");
      if (!toggle || toggle.classList.contains("tree-toggle-spacer")) return;

      if (alwaysExpanded.indexOf(node) === -1 && key && state[key] === true) {
        node.classList.add("is-collapsed");
      }
      toggle.setAttribute("aria-expanded", node.classList.contains("is-collapsed") ? "false" : "true");

      toggle.addEventListener("click", function () {
        node.classList.toggle("is-collapsed");
        var collapsed = node.classList.contains("is-collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
        if (key) {
          var s = readState();
          s[key] = collapsed;
          writeState(s);
        }
      });
    });
  }

  function initDrawer() {
    var toggle = document.getElementById("drawer-toggle");
    var backdrop = document.getElementById("drawer-backdrop");
    if (!toggle) return;
    function close() {
      document.body.classList.remove("drawer-open");
      toggle.setAttribute("aria-expanded", "false");
    }
    function open() {
      document.body.classList.add("drawer-open");
      toggle.setAttribute("aria-expanded", "true");
    }
    toggle.addEventListener("click", function () {
      if (document.body.classList.contains("drawer-open")) close();
      else open();
    });
    if (backdrop) backdrop.addEventListener("click", close);
  }

  function initThemeToggle() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme") || "light";
      var next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* ignore */
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var alwaysExpanded = initCurrentHighlightAndAncestors();
    initAccordion(alwaysExpanded);
    initDrawer();
    initThemeToggle();
  });
})();
