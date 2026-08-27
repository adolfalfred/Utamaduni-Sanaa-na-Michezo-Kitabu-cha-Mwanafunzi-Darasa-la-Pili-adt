(function () {
  "use strict";

  var VIDEO_SELECTOR = 'video[src*="/video/"]';
  var enhancedHandles = new WeakSet();
  var scheduled = false;

  function viewportSize() {
    var viewport = window.visualViewport;
    return {
      left: viewport ? viewport.offsetLeft : 0,
      top: viewport ? viewport.offsetTop : 0,
      width: viewport ? viewport.width : window.innerWidth,
      height: viewport ? viewport.height : window.innerHeight
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(value, maximum));
  }

  function movePlayer(player, x, y) {
    var size = viewportSize();
    var width = player.offsetWidth;
    var height = player.offsetHeight;
    var nextX = clamp(x, size.left, Math.max(size.left, size.left + size.width - width));
    var nextY = clamp(y, size.top, Math.max(size.top, size.top + size.height - height));

    player.style.left = nextX + "px";
    player.style.top = nextY + "px";
    player.style.right = "auto";
    player.style.bottom = "auto";
  }

  function keepPlayerOnScreen(player) {
    window.requestAnimationFrame(function () {
      if (!player.isConnected) return;
      var rect = player.getBoundingClientRect();
      var size = viewportSize();
      var fullyVisible =
        rect.left >= size.left &&
        rect.top >= size.top &&
        rect.right <= size.left + size.width &&
        rect.bottom <= size.top + size.height;

      if (!fullyVisible) movePlayer(player, rect.left, rect.top);
    });
  }

  function enhanceHandle(handle, player) {
    if (enhancedHandles.has(handle)) return;
    if (!player || !player.querySelector("video")) return;

    enhancedHandles.add(handle);
    handle.setAttribute("data-sign-language-drag-handle", "");
    player.setAttribute("data-sign-language-player", "");

    var drag = null;

    handle.addEventListener(
      "touchstart",
      function (event) {
        if (event.touches.length !== 1) return;
        var touch = event.touches[0];
        var rect = player.getBoundingClientRect();
        drag = {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top
        };
        player.setAttribute("data-sign-language-dragging", "");
        event.preventDefault();
      },
      { passive: false }
    );

    handle.addEventListener(
      "touchmove",
      function (event) {
        if (!drag || event.touches.length !== 1) return;
        var touch = event.touches[0];
        movePlayer(player, touch.clientX - drag.x, touch.clientY - drag.y);
        event.preventDefault();
      },
      { passive: false }
    );

    function finishTouch(event) {
      if (!drag) return;
      var touch = event.changedTouches && event.changedTouches[0];
      if (touch) movePlayer(player, touch.clientX - drag.x, touch.clientY - drag.y);
      drag = null;
      player.removeAttribute("data-sign-language-dragging");
      event.preventDefault();
    }

    handle.addEventListener("touchend", finishTouch, { passive: false });
    handle.addEventListener("touchcancel", finishTouch, { passive: false });

    var video = player.querySelector("video");
    if (video) video.addEventListener("loadedmetadata", function () { keepPlayerOnScreen(player); });
    keepPlayerOnScreen(player);
  }

  function install() {
    scheduled = false;
    var videos = document.querySelectorAll(VIDEO_SELECTOR);
    Array.prototype.forEach.call(videos, function (video) {
      var player = video.parentElement;
      if (!player || window.getComputedStyle(player).position !== "fixed") return;

      var handle = Array.prototype.find.call(player.children, function (child) {
        return child.getAttribute && child.getAttribute("role") === "button";
      });
      if (!handle) return;

      enhanceHandle(handle, player);
      keepPlayerOnScreen(player);
    });
  }

  function scheduleInstall() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(install);
  }

  var observer = new MutationObserver(scheduleInstall);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleInstall);
  window.addEventListener("orientationchange", scheduleInstall);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleInstall);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleInstall, { once: true });
  } else {
    scheduleInstall();
  }
})();
