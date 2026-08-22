const defaultPyodideUrl = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js";

let _apps = {};
let _documentUrl = document.URL;

// This method is called from Dart on backend.connect()
// dartOnMessage is called on backend.onMessage
// it accepts "data" of type JSUint8Array
globalThis.jsConnect = async function (appId, args, dartOnMessage) {
    let app = {
        "dartOnMessage": dartOnMessage
    };
    console.log(`Starting up Python worker: ${appId}, args: ${args}`);
    _apps[appId] = app;
    app.worker = new Worker((flet.entrypointBaseUrl.endsWith("/") ?
        flet.entrypointBaseUrl.slice(0, -1) : flet.entrypointBaseUrl) + "/python-worker.js");
    // [Album-dnd] Expone el worker de Python para que el detector de
    // "arrastrar y soltar" y el botón "elegir carpeta"
    // (inyectados en index.html) puedan mandarle directamente los
    // bytes de los ZIP soltados/elegidos sobre la página — atajo
    // para iPad, donde el selector de archivos no abre el diálogo
    // nativo de iOS (ver habilitar_arrastrar_zip.py).
    window.__fletPyWorker = app.worker;
    // [Album-dnd] Dirección contraria: mensajes del worker (Python)
    // hacia el hilo principal. Se usa para que main.py avise, con
    // _notificar_pagina_activa(), qué pestaña está activa ahora
    // ("galeria" o "ajustes") — el botón "elegir carpeta" solo debe
    // verse en Ajustes, y como vive fuera del árbol de controles de
    // Flet (todo se dibuja en un único <canvas>, sin DOM por
    // control) necesita que se le avise por fuera. Se usa
    // addEventListener, no una reasignación de app.worker.onmessage,
    // para no interferir con la comunicación normal de Flet.
    app.worker.addEventListener("message", function (event) {
        if (event.data && event.data.__albumPage) {
            window.dispatchEvent(new CustomEvent("album-page-change",
                { detail: event.data.__albumPage }));
        }
    });

    var error;
    app.worker.onmessage = (event) => {
        if (typeof event.data === "string") {
            if (event.data != "initialized") {
                error = event.data;
            }
            app.onPythonInitialized();
        } else {
            app.dartOnMessage(event.data);
        }
    };

    let pythonInitialized = new Promise((resolveCallback) => app.onPythonInitialized = resolveCallback);

    // initialize worker
    app.worker.postMessage({
        pyodideUrl: flet.noCdn ? flet.pyodideUrl : defaultPyodideUrl,
        args: args,
        documentUrl: _documentUrl,
        appPackageUrl: flet.appPackageUrl,
        micropipIncludePre: flet.micropipIncludePre,
        pythonModuleName: flet.pythonModuleName
    });

    await pythonInitialized;

    if (error) {
        console.log("Python worker init error:", error);
        throw error;
    } else {
        console.log(`Python worker initialized: ${appId}`);
    }
}

// Called from Dart on backend.send
// data is a message serialized to JSUint8Array
globalThis.jsSend = async function (appId, data) {
    if (appId in _apps) {
        const app = _apps[appId];
        app.worker.postMessage(data);
    }
}

// Called from Dart on channel.disconnect
globalThis.jsDisconnect = async function (appId) {
    if (appId in _apps) {
        console.log(`Terminating Python worker: ${appId}`);
        const app = _apps[appId];
        delete _apps[appId];
        app.worker.terminate();
        app.worker.onmessage = null;
        app.worker.onerror = null;
    }
}
