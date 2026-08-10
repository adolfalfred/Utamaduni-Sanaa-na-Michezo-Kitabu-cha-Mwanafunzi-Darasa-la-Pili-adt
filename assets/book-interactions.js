(function () {
  "use strict";

  function storageKey(control) {
    var pageName = window.location.pathname.split("/").pop().replace(/\.html?$/i, "");
    return pageName + "_" + control.getAttribute("data-aria-id");
  }

  function resetNoticeKey(activity) {
    var pageName = window.location.pathname.split("/").pop().replace(/\.html?$/i, "");
    return "adt-reset:" + pageName + ":" + activity.getAttribute("data-activity-id");
  }

  function drawingStorageKey(card, suffix) {
    var pageName = window.location.pathname.split("/").pop().replace(/\.html?$/i, "");
    return "adt-drawing:" + pageName + ":" + card.getAttribute("data-drawing-id") + ":" + suffix;
  }

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // Drawing remains usable when browser storage is unavailable.
    }
  }

  function safeStorageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (_error) {
      // Nothing else is required when browser storage is unavailable.
    }
  }

  function initialiseDrawingResponse(card) {
    var canvas = card.querySelector("[data-drawing-canvas]");
    var alternative = card.querySelector("[data-drawing-alternative]");
    var response = card.querySelector("[data-response]");
    var colour = card.querySelector("[data-drawing-colour]");
    var clear = card.querySelector("[data-clear-drawing]");
    var status = card.querySelector("[data-drawing-status]");
    if (!canvas || !alternative || !response) return;

    var context = canvas.getContext("2d");
    if (!context) return;
    alternative.setAttribute("data-braille-native", "true");
    response.type = "text";
    response.classList.add("sr-only", "drawing-runtime-response");
    response.tabIndex = -1;
    response.setAttribute("aria-hidden", "true");
    var drawingKey = drawingStorageKey(card, "image");
    var alternativeKey = drawingStorageKey(card, "alternative");
    var hasDrawing = false;
    var drawing = false;

    function announce(message) {
      if (status) status.textContent = message;
    }

    function syncResponse() {
      response.value = alternative.value.trim() || (hasDrawing ? "Mchoro umehifadhiwa." : "");
      response.dispatchEvent(new Event("input", { bubbles: true }));
      response.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function clearCanvas(announceChange) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawing = false;
      safeStorageRemove(drawingKey);
      syncResponse();
      if (announceChange) announce("Mchoro huu umefutwa.");
    }

    function pointFromEvent(event) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
      };
    }

    function beginDrawing(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      var point = pointFromEvent(event);
      context.beginPath();
      context.moveTo(point.x, point.y);
      event.preventDefault();
    }

    function continueDrawing(event) {
      if (!drawing) return;
      var point = pointFromEvent(event);
      context.lineWidth = 7;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = colour ? colour.value : "#111827";
      context.lineTo(point.x, point.y);
      context.stroke();
      hasDrawing = true;
      event.preventDefault();
    }

    function finishDrawing(event) {
      if (!drawing) return;
      drawing = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (hasDrawing) {
        safeStorageSet(drawingKey, canvas.toDataURL("image/png"));
        syncResponse();
        announce("Mchoro umehifadhiwa kwenye kifaa hiki.");
      }
    }

    var storedAlternative = safeStorageGet(alternativeKey);
    if (storedAlternative) alternative.value = storedAlternative;
    var storedDrawing = safeStorageGet(drawingKey);
    if (storedDrawing) {
      var image = new Image();
      image.onload = function () {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        hasDrawing = true;
        syncResponse();
      };
      image.src = storedDrawing;
    } else {
      syncResponse();
    }

    canvas.addEventListener("pointerdown", beginDrawing);
    canvas.addEventListener("pointermove", continueDrawing);
    canvas.addEventListener("pointerup", finishDrawing);
    canvas.addEventListener("pointercancel", finishDrawing);
    alternative.addEventListener("input", function () {
      safeStorageSet(alternativeKey, alternative.value);
      syncResponse();
    });
    if (clear) clear.addEventListener("click", function () { clearCanvas(true); });

    card.clearDrawingResponse = function () {
      alternative.value = "";
      safeStorageRemove(alternativeKey);
      clearCanvas(false);
    };
  }

  function setFeedback(activity, message, state) {
    var feedback = activity.querySelector("[data-activity-feedback]");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = state || "";
  }

  function initialiseActivity(activity) {
    var responses = Array.prototype.slice.call(activity.querySelectorAll("[data-response]"));
    var drawings = Array.prototype.slice.call(activity.querySelectorAll("[data-drawing-response]"));
    responses.forEach(function (control) {
      if (!control.closest("[data-drawing-response]")) {
        var storedValue = safeStorageGet(storageKey(control));
        if (storedValue !== null) control.value = storedValue;
      }
      var persistResponse = function () {
        safeStorageSet(storageKey(control), control.value);
      };
      control.addEventListener("input", persistResponse);
      control.addEventListener("change", persistResponse);
    });
    try {
      if (window.sessionStorage.getItem(resetNoticeKey(activity))) {
        window.sessionStorage.removeItem(resetNoticeKey(activity));
        setFeedback(activity, "Majibu yamefutwa. Unaweza kuanza tena.", "");
      }
    } catch (_error) {
      // The activity remains usable when browser storage is unavailable.
    }

    var reset = activity.querySelector("[data-reset-activity]");
    if (reset) {
      reset.addEventListener("click", function () {
        drawings.forEach(function (card) {
          if (typeof card.clearDrawingResponse === "function") card.clearDrawingResponse();
        });
        responses.forEach(function (control) {
          control.value = "";
          try {
            window.localStorage.removeItem(storageKey(control));
          } catch (_error) {
            // Nothing else is required when browser storage is unavailable.
          }
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
        });
        try {
          window.sessionStorage.setItem(resetNoticeKey(activity), "1");
        } catch (_error) {
          // The page can still reload into its cleared state without a notice.
        }
        window.location.reload();
      });
    }
  }

  function initialise(root) {
    root.querySelectorAll("[data-drawing-response]").forEach(initialiseDrawingResponse);
    root.querySelectorAll("[data-activity-id]").forEach(initialiseActivity);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initialise(document);
    });
  } else {
    initialise(document);
  }
})();
