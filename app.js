// js/app.js
(() => {
  // Datos de vuelos cargados desde CSV
  // Estructura: [{ date: 'YYYY-MM-DD', flight: 'FO5123', loader: 'Juan', total: 120, bags: ['123','456',...] }]
  let flightsData = [];

  // Vuelo actualmente seleccionado
  let currentFlight = null;

  // Mapa BACTAG -> elemento DOM
  let currentBagElements = new Map();

  // Buffer para lectura del escáner (lector USB como teclado)
  let scanBuffer = "";
  let scanTimeout = null;

  // ==== Helpers cortos ====
  const $ = (sel) => document.querySelector(sel);

  const fileInput = $("#fileInput");
  const fileStatus = $("#fileStatus");
  const flightDateInput = $("#flightDate");
  const flightNumberInput = $("#flightNumber");
  const btnLoadFlight = $("#btnLoadFlight");
  const flightInfo = $("#flightInfo");
  const bagsContainer = $("#bagsContainer");
  const totalBagsEl = $("#totalBags");
  const scannedBagsEl = $("#scannedBags");
  const scanResult = $("#scanResult");

  // ========= PARSEO DEL CSV =========
  // Configuración de tu Excel:
  // Col A: Día/Fecha
  // Col B: Vuelo
  // Col C: Maletero
  // Col D: Total valijas
  // Col E: (sin uso)
  // Col F en adelante: códigos de valijas (BACTAG)

  function normalizeDateToISO(str) {
    if (!str) return null;
    str = str.trim();

    // yyyy-mm-dd
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    // dd/mm/yyyy o dd-mm-yyyy
    const euMatch = str.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (euMatch) {
      const d = euMatch[1];
      const m = euMatch[2];
      const y = euMatch[3];
      return `${y}-${m}-${d}`;
    }

    // Intento Date nativo (por las dudas)
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    return null;
  }

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const header = lines[0];

    // Detecto delimitador ; o ,
    const semiCount = (header.match(/;/g) || []).length;
    const commaCount = (header.match(/,/g) || []).length;
    const delim = semiCount > commaCount ? ";" : ",";

    const out = [];

    for (let i = 1; i < lines.length; i++) { // desde fila 2 de Excel
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(delim).map(c => c.trim());

      const rawDate  = cols[0] || ""; // Col A: Día
      const rawFlight = cols[1] || ""; // Col B: Vuelo
      const loader   = cols[2] || ""; // Col C: Maletero
      const totalStr = cols[3] || ""; // Col D: Total valijas (opcional)

      const isoDate = normalizeDateToISO(rawDate);
      if (!isoDate || !rawFlight) continue;

      const flight = rawFlight.toUpperCase();

      // Códigos de valijas desde columna F (índice 5) hacia la derecha
      const bags = cols
        .slice(5)              // F en adelante
        .map(c => c.trim())
        .filter(c => c !== ""); // saco vacíos

      if (bags.length === 0) continue;

      const total = parseInt(totalStr, 10);
      out.push({
        date: isoDate,
        flight,
        loader,
        total: isNaN(total) ? null : total,
        bags
      });
    }

    return out;
  }

  function handleFileChange(evt) {
    const file = evt.target.files[0];
    if (!file) {
      fileStatus.textContent = "No se seleccionó archivo.";
      fileStatus.className = "status-message status-warn";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        flightsData = parseCsv(e.target.result);
        if (flightsData.length === 0) {
          fileStatus.textContent = "No se encontraron vuelos válidos en el CSV. Revisá columnas A-B y valijas desde F.";
          fileStatus.className = "status-message status-error";
        } else {
          fileStatus.textContent = `Archivo cargado. Vuelos encontrados: ${flightsData.length}.`;
          fileStatus.className = "status-message status-ok";
        }
      } catch (err) {
        console.error(err);
        fileStatus.textContent = "Error al leer el archivo. Revisá el formato (separador ; o ,).";
        fileStatus.className = "status-message status-error";
      }
    };
    reader.onerror = () => {
      fileStatus.textContent = "No se pudo leer el archivo.";
      fileStatus.className = "status-message status-error";
    };
    reader.readAsText(file, "utf-8");
  }

  // ========= CARGA DE VUELO =========

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
    const dateVal = flightDateInput.value;
    const flightVal = (flightNumberInput.value || "").trim().toUpperCase();

    if (!dateVal || !flightVal) {
      flightInfo.textContent = "Completá la fecha y el número de vuelo.";
      flightInfo.className = "status-message status-warn";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    if (!flightsData || flightsData.length === 0) {
      flightInfo.textContent = "Primero cargá un archivo CSV exportado desde tu Excel.";
      flightInfo.className = "status-message status-warn";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    const found = flightsData.filter(
      f => f.date === dateVal && f.flight === flightVal
    );

    if (found.length === 0) {
      flightInfo.textContent = `No encontré el vuelo ${flightVal} en la fecha ${dateVal}.`;
      flightInfo.className = "status-message status-error";
      currentFlight = null;
      renderFlightBags(null);
      return;
    }

    currentFlight = found[0];

    const loaderInfo = currentFlight.loader ? ` - Maletero: ${currentFlight.loader}` : "";
    const totalInfo  = currentFlight.total != null ? ` - Total planificado: ${currentFlight.total}` : "";

    flightInfo.textContent =
      `Vuelo cargado: ${currentFlight.flight} - ${currentFlight.date}${loaderInfo}${totalInfo} - Valijas en lista: ${currentFlight.bags.length}`;
    flightInfo.className = "status-message status-ok";

    renderFlightBags(currentFlight);
    clearScanResult();
  }

  // ========= ESCANEO (LECTOR USB) =========

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

    const normalized = code.trim();

    // ¿Está en el vuelo actual?
    const el = currentBagElements.get(normalized);
    if (el) {
      // Marco como escaneada OK
      el.classList.remove("bag-unscanned");
      el.classList.add("bag-scanned-ok");

      updateScannedCounter();

      scanResult.textContent =
        `OK: ${normalized} pertenece al vuelo actual (${currentFlight.flight} - ${currentFlight.date}).`;
      scanResult.classList.add("scan-result-ok");
      return;
    }

    // No está en el vuelo actual: lo busco en el resto
    const other = flightsData.find(
      f => !(currentFlight && f.date === currentFlight.date && f.flight === currentFlight.flight) &&
           f.bags.includes(normalized)
    );

    if (other) {
      scanResult.textContent =
        `ATENCIÓN: ${normalized} NO pertenece al vuelo actual. ` +
        `Está cargado en el vuelo ${other.flight} del día ${other.date}.`;
      scanResult.classList.add("scan-result-warn");
      return;
    }

    // No está en ningún vuelo
    scanResult.textContent =
      `ERROR: ${normalized} no se encontró en ningún vuelo del archivo cargado.`;
    scanResult.classList.add("scan-result-error");
  }

  function handleKeydown(e) {
    // Si estoy escribiendo en inputs, no capturar para el escáner
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (scanTimeout) clearTimeout(scanTimeout);

    if (e.key === "Enter") {
      // Fin de código escaneado
      const code = scanBuffer.trim();
      scanBuffer = "";
      if (code) {
        handleScannedCode(code);
      }
      return;
    }

    // Teclas de un solo carácter (el scanner las tira muy rápido)
    if (e.key.length === 1) {
      scanBuffer += e.key;
    }

    // Por si se corta la lectura, limpiar el buffer a los 150 ms
    scanTimeout = setTimeout(() => {
      scanBuffer = "";
    }, 150);
  }

  // ========= EVENTOS =========

  fileInput.addEventListener("change", handleFileChange);
  btnLoadFlight.addEventListener("click", loadSelectedFlight);
  document.addEventListener("keydown", handleKeydown);

  // Podés dejar vuelos de ejemplo o borrar esto para usar solo tu Excel.
  flightsData = [];
  fileStatus.textContent = "Esperando archivo CSV exportado desde tu Excel (día en A, vuelo en B, valijas desde F).";
  fileStatus.className = "status-message status-warn";
})();
