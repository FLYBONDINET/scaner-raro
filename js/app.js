// js/app.js
(() => {
  // URL de tu Apps Script publicado como Web App
  const API_URL = 'https://script.google.com/macros/s/AKfycbyrQxoZMy9bPgynb09Y1JNXPsFsotW7cIz8T1jOey8VUMkB97mYAjbgQnOVk66ylcQN7A/exec';

  // Estructura: [{ date:'YYYY-MM-DD', flight:'XXX123', loader:'', total: N, bags:[...] }]
  let flightsData = [];

  // Vuelo actualmente seleccionado
  let currentFlight = null;

  // Mapa BACTAG -> elemento DOM
  let currentBagElements = new Map();

  // Buffer para lectura del escáner (lector USB como teclado)
  let scanBuffer = "";
  let scanTimeout = null;

  const $ = sel => document.querySelector(sel);

  const sheetStatus = $("#sheetStatus");
  const flightDateInput = $("#flightDate");
  const flightSelect = $("#flightSelect");
  const btnLoadFlight = $("#btnLoadFlight");
  const flightInfo = $("#flightInfo");
  const bagsContainer = $("#bagsContainer");
  const totalBagsEl = $("#totalBags");
  const scannedBagsEl = $("#scannedBags");
  const scanResult = $("#scanResult");

  // ==================== FETCH DE LA HOJA ====================

  async function loadSheetData() {
    try {
      sheetStatus.textContent = "Cargando datos desde la hoja 'data'...";
      sheetStatus.className = "status-message";

      const res = await fetch(API_URL);
      console.log("Status fetch:", res.status, res.statusText);

      const text = await res.text();
      console.log("Respuesta cruda del Apps Script:", text);

      if (!res.ok) {
        throw new Error("HTTP " + res.status + " " + res.statusText);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error("Error parseando JSON:", e);
        throw new Error("La respuesta del Apps Script no es JSON válido (¿login de Google o error HTML?).");
      }

      flightsData = Array.isArray(data) ? data : [];

      if (flightsData.length === 0) {
        sheetStatus.textContent = "No se encontraron vuelos en la hoja 'data'. Verificá los datos (fecha en A, vuelo en B, bags desde F).";
        sheetStatus.className = "status-message status-warn";
      } else {
        sheetStatus.textContent = `Conectado. Vuelos cargados: ${flightsData.length}.`;
        sheetStatus.className = "status-message status-ok";
      }
    } catch (err) {
      console.error("Error en loadSheetData:", err);
      sheetStatus.textContent = "Error al conectar con la hoja: " + err.message;
      sheetStatus.className = "status-message status-error";
    }
  }

  // ==================== UI: vuelos por fecha ====================

  function fillFlightsForDate() {
    const dateVal = flightDateInput.value;
    flightSelect.innerHTML = '<option value="">-- Seleccioná un vuelo --</option>';
    flightInfo.textContent = "";
    flightInfo.className = "status-message";

    if (!dateVal) return;
    if (!flightsData || flightsData.length === 0) return;

    const flightsForDay = flightsData
      .map((f, idx) => ({ ...f, idx }))
      .filter(f => f.date === dateVal);

    if (flightsForDay.length === 0) {
      flightInfo.textContent = `No hay vuelos para la fecha ${dateVal}.`;
      flightInfo.className = "status-message status-warn";
      return;
    }

    flightsForDay.forEach(f => {
      const opt = document.createElement("option");
      opt.value = String(f.idx); // índice dentro de flightsData
      const loaderInfo = f.loader ? ` - Maletero: ${f.loader}` : "";
      const totalInfo  = f.total != null ? ` - Total: ${f.total}` : "";
      opt.textContent = `${f.flight}${loaderInfo}${totalInfo} (bags: ${f.bags.length})`;
      flightSelect.appendChild(opt);
    });

    flightInfo.textContent = `Vuelos encontrados para ${dateVal}: ${flightsForDay.length}`;
    flightInfo.className = "status-message status-ok";
  }

  function renderFlightBags(flightObj) {
    bagsContainer.innerHTML = "";
    currentBagElements.clear();

    if (!flightObj) {
      totalBagsEl.textContent = "0";
      scannedBagsEl.textContent = "0";
      return;
    }

    flightObj.bags.forEach(code => {
      const div = document.createElement("div");
      div.className = "bag bag-unscanned";
      div.textContent = code;
      div.dataset.code = code;
      bagsContainer.appendChild(div);
      currentBagElements.set(code, div);
    });

    totalBagsEl.textContent = String(flightObj.bags.length);
    scannedBagsEl.textContent = "0";
  }

  function loadSelectedFlight() {
    const idxStr = flightSelect.value;
    const dateVal = flightDateInput.value;

    if (!dateVal) {
      flightInfo.textContent = "Primero seleccioná una fecha.";
      flightInfo.className = "status-message status-warn";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    if (!idxStr) {
      flightInfo.textContent = "Seleccioná un vuelo de la lista.";
      flightInfo.className = "status-message status-warn";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || !flightsData[idx]) {
      flightInfo.textContent = "Vuelo inválido.";
      flightInfo.className = "status-message status-error";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    currentFlight = flightsData[idx];

    const loaderInfo = currentFlight.loader ? ` - Maletero: ${currentFlight.loader}` : "";
    const totalInfo  = currentFlight.total != null ? ` - Total planificado: ${currentFlight.total}` : "";

    flightInfo.textContent =
      `Vuelo cargado: ${currentFlight.flight} - ${currentFlight.date}${loaderInfo}${totalInfo} - Valijas en lista: ${currentFlight.bags.length}`;
    flightInfo.className = "status-message status-ok";

    renderFlightBags(currentFlight);
    clearScanResult();
  }

  // ==================== SCAN (lector código de barras) ====================

  function clearScanResult() {
    scanResult.textContent = "";
    scanResult.className = "scan-result";
  }

  function updateScannedCounter() {
    let count = 0;
    for (const el of currentBagElements.values()) {
      if (el.classList.contains("bag-scanned-ok")) {
        count++;
      }
    }
    scannedBagsEl.textContent = String(count);
  }

  function handleScannedCode(code) {
    if (!code) return;

    clearScanResult();

    if (!currentFlight) {
      scanResult.textContent = `Código ${code}: todavía no hay vuelo seleccionado.`;
      scanResult.classList.add("scan-result-error");
      return;
    }

   // Normalizar: quitar ceros a la izquierda
let normalized = code.trim().replace(/^0-/, "");

    // 1) ¿Está en el vuelo actual?
    const el = currentBagElements.get(normalized);
    if (el) {
      el.classList.remove("bag-unscanned");
      el.classList.add("bag-scanned-ok");

      updateScannedCounter();

      scanResult.textContent = `OK: ${normalized} pertenece al vuelo actual (${currentFlight.flight} - ${currentFlight.date}).`;
      scanResult.classList.add("scan-result-ok");
      return;
    }

    // 2) No está en el vuelo actual: lo busco en toda la hoja (todos los vuelos)
    const other = flightsData.find(
      f => !(currentFlight && f.date === currentFlight.date && f.flight === currentFlight.flight) &&
           f.bags.includes(normalized)
    );

    if (other) {
      scanResult.textContent =
        `ATENCIÓN: ${normalized} NO está en el listado de este vuelo. ` +
        `Se encontró en la hoja en el vuelo ${other.flight} del día ${other.date}.`;
      scanResult.classList.add("scan-result-warn");
      return;
    }

    // 3) No está en ningún vuelo de la hoja
    scanResult.textContent =
      `ERROR: ${normalized} no se encontró en ningún vuelo de la hoja 'data'.`;
    scanResult.classList.add("scan-result-error");
  }

  function handleKeydown(e) {
    // No capturar si está escribiendo en inputs
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

    if (scanTimeout) clearTimeout(scanTimeout);

    if (e.key === "Enter") {
      const code = scanBuffer.trim();
      scanBuffer = "";
      if (code) {
        handleScannedCode(code);
      }
      return;
    }

    // El lector USB tira caracteres rápido como teclado
    if (e.key.length === 1) {
      scanBuffer += e.key;
    }

    // Si se corta la lectura, limpio el buffer
    scanTimeout = setTimeout(() => {
      scanBuffer = "";
    }, 150);
  }

  // ==================== EVENTOS Y ARRANQUE ====================

  flightDateInput.addEventListener("change", fillFlightsForDate);
  btnLoadFlight.addEventListener("click", loadSelectedFlight);
  document.addEventListener("keydown", handleKeydown);

  // Cargar datos al iniciar
  loadSheetData();
})();
