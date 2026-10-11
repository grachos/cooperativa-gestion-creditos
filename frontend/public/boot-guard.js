/*
 * Red de seguridad de arranque. Se carga ANTES del bundle de la app (script
 * clásico, mismo origen: cumple la CSP). Si la app no llega a pintarse —un
 * archivo JS que no cargó, p. ej. por una versión vieja en caché del navegador,
 * o un error al iniciar— muestra el motivo en pantalla y un botón para
 * recuperarse, en vez de dejar la página en blanco (en el celular no hay consola).
 */
(function () {
  var shown = false;
  var NOT_BOOTED_MS = 10000;

  function rootIsEmpty() {
    var root = document.getElementById("root");
    return !root || root.childElementCount === 0;
  }

  function el(tag, styles, text) {
    var node = document.createElement(tag);
    if (styles) node.style.cssText = styles;
    if (text) node.textContent = text;
    return node;
  }

  function reloadClean() {
    var tasks = [];
    try {
      if (window.caches && caches.keys) {
        tasks.push(caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); }));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        tasks.push(navigator.serviceWorker.getRegistrations().then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); }));
      }
    } catch (e) { /* seguir con la recarga */ }
    Promise.all(tasks).catch(function () {}).then(function () {
      var url = location.pathname + "?r=" + Date.now() + location.hash;
      location.replace(url);
    });
  }

  function showFatal(title, detail) {
    if (shown || !rootIsEmpty()) return;
    shown = true;
    var box = el("div", "font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto 0;padding:24px;");
    box.setAttribute("role", "alert");
    box.appendChild(el("h1", "font-size:20px;margin:0 0 8px;color:#1e293b;", "No se pudo cargar la aplicación"));
    box.appendChild(el("p", "margin:0 0 16px;color:#475569;font-size:15px;", title));
    var btn = el("button", "background:#a85a93;color:#fff;border:0;border-radius:8px;padding:12px 18px;font-size:16px;width:100%;", "Recargar la aplicación");
    btn.type = "button";
    btn.addEventListener("click", reloadClean);
    box.appendChild(btn);
    box.appendChild(el("p", "margin:16px 0 4px;color:#94a3b8;font-size:12px;", "Detalle técnico (si el problema sigue, envíe una captura de este mensaje):"));
    box.appendChild(el("pre", "white-space:pre-wrap;word-break:break-word;background:#f1f5f9;border-radius:8px;padding:10px;font-size:12px;color:#334155;margin:0;", detail));
    document.body.appendChild(box);
  }

  window.addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (t && t !== window && (t.tagName === "SCRIPT" || t.tagName === "LINK")) {
        showFatal(
          "No se pudo descargar un archivo de la aplicación. Suele pasar justo después de una actualización, con una versión vieja guardada en el navegador.",
          "Archivo: " + (t.src || t.href) + "\nPágina: " + location.href
        );
        return;
      }
      if (rootIsEmpty()) {
        showFatal("Ocurrió un error al iniciar.", (e.message || "Error") + (e.filename ? "\n" + e.filename + ":" + e.lineno : "") + "\nPágina: " + location.href);
      }
    },
    true
  );

  window.addEventListener("unhandledrejection", function (e) {
    if (rootIsEmpty()) {
      var reason = e.reason;
      showFatal("Ocurrió un error al iniciar.", String((reason && reason.stack) || (reason && reason.message) || reason) + "\nPágina: " + location.href);
    }
  });

  setTimeout(function () {
    if (!window.__appBooted && rootIsEmpty()) {
      showFatal("La aplicación no terminó de cargar.", "Sin respuesta tras " + NOT_BOOTED_MS / 1000 + " s\nPágina: " + location.href + "\nNavegador: " + navigator.userAgent);
    }
  }, NOT_BOOTED_MS);
})();
