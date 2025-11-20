// Parámetros del detector
const MAX_INTERVAL_MS = 50;  // Máximo tiempo entre teclas para considerarlo "escaneo"
let listening = false;
let buffer = "";
let lastTime = 0;
let codes = [];
let keyListener = null;

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const statusText = document.getElementById("statusText");
const lastCodeDiv = document.getElementById("lastCode");
const tableBody = document.getElementById("codesTableBody");

btnStart.addEventListener("click", () => {
  if (!listening) {
    startListening();
  }
});

btnStop.addEventListener("click", () => {
  if (listening) {
    stopListening();
  }
});

function startListening() {
  listening = true;
  buffer = "";
  lastTime = 0;

  statusText.textContent = "Escuchando scanner...";
  statusText.style.color = "green";

  btnStart.disabled = true;
  btnStop.disabled = false;

  keyListener = (e) => {
    // Ignorar si no estamos "escuchando"
    if (!listening) return;

    const now = Date.now();

    // Reset del buffer si el tiempo entre teclas es muy largo
    if (lastTime && now - lastTime > MAX_INTERVAL_MS) {
      buffer = "";
    }
    lastTime = now;

    // Si el scanner manda ENTER, significa que terminó de enviar el código
    if (e.key === "Enter") {
      if (buffer.length > 0) {
        onCodeRead(buffer);
        buffer = "";
      }
      e.preventDefault();
      return;
    }

    // Solo agregamos caracteres "simples"
    // e.key.length === 1 -> letras, números, etc.
    if (e.key.length === 1) {
      buffer += e.key;
    }
  };

  document.addEventListener("keydown", keyListener);
}

function stopListening() {
  listening = false;
  statusText.textContent = "Inactivo";
  statusText.style.color = "red";

  btnStart.disabled = false;
  btnStop.disabled = true;

  if (keyListener) {
    document.removeEventListener("keydown", keyListener);
    keyListener = null;
  }
}

// Cuando se leyó un código completo
function onCodeRead(code) {
  lastCodeDiv.textContent = code;

  const timestamp = new Date().toLocaleString();
  const item = { code, timestamp };
  codes.push(item);

  addRowToTable(item);

  // Pequeño "beep" visual (podrías agregar sonido si querés)
  flashLastCode();
}

function addRowToTable(item) {
  const row = document.createElement("tr");
  const indexCell = document.createElement("td");
  const codeCell = document.createElement("td");
  const timeCell = document.createElement("td");

  indexCell.textContent = codes.length;
  codeCell.textContent = item.code;
  timeCell.textContent = item.timestamp;

  row.appendChild(indexCell);
  row.appendChild(codeCell);
  row.appendChild(timeCell);

  tableBody.appendChild(row);
}

function flashLastCode() {
  lastCodeDiv.style.backgroundColor = "#bbf7d0"; // verde clarito
  setTimeout(() => {
    lastCodeDiv.style.backgroundColor = "#e5e7eb";
  }, 150);
}
