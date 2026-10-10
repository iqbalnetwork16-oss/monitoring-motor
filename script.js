import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

/*
  LANGKAH WAJIB:
  1. Firebase Console > Project settings > General > Your apps > Web app.
  2. Salin konfigurasi Web App ke firebaseConfig di bawah.
  3. Aktifkan Authentication > Sign-in method > Email/Password.
  4. Tambahkan domain hosting (mis. username.github.io) ke Authentication > Settings > Authorized domains.
  Jangan pernah menaruh password akun di file ini.
*/
const firebaseConfig = {
  apiKey: "AIzaSyB8yew5i4xgKs3IiEg80W4JzqV5IzFuBTE",
  authDomain: "monitoring--kendaraan.firebaseapp.com",
  databaseURL:
    "https://monitoring--kendaraan-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "monitoring--kendaraan",
  appId: "1:281495511128:web:f34ef590923cf9a1bdaa2d",
};

const DATA_PATH = "/monitoring_motor/latest";
const STALE_AFTER_MS = 15000;
const MAX_HISTORY_SECONDS = 900;
const ADDRESS_MIN_INTERVAL_MS = 30000;
const ADDRESS_MOVE_THRESHOLD_DEG = 0.0005; // kira-kira puluhan meter; tergantung lintang

const $ = (id) => document.getElementById(id);
const els = {
  connectionBadge: $("connectionBadge"), connectionText: $("connectionText"),
  lastUpdated: $("lastUpdated"), speedValue: $("speedValue"), rollValue: $("rollValue"),
  pitchValue: $("pitchValue"), gpsValue: $("gpsValue"), gpsFoot: $("gpsFoot"),
  rollLarge: $("rollLarge"), pitchLarge: $("pitchLarge"), rollNeedle: $("rollNeedle"),
  pitchBar: $("pitchBar"), latitudeValue: $("latitudeValue"), longitudeValue: $("longitudeValue"),
  googleMapsLink: $("googleMapsLink"), addressValue: $("addressValue"), addressSub: $("addressSub"),
  addressStatus: $("addressStatus"), gpsIndicator: $("gpsIndicator"), buzzerIndicator: $("buzzerIndicator"),
  freshIndicator: $("freshIndicator"), gpsStatusDetail: $("gpsStatusDetail"), buzzerStatus: $("buzzerStatus"),
  freshStatus: $("freshStatus"), counterValue: $("counterValue"), axValue: $("axValue"),
  ayValue: $("ayValue"), azValue: $("azValue"), gxValue: $("gxValue"), gyValue: $("gyValue"),
  gzValue: $("gzValue"), toast: $("toast"), loginDialog: $("loginDialog"), loginForm: $("loginForm"),
  loginError: $("loginError"), loginSubmit: $("loginSubmit"), emailInput: $("emailInput"),
  passwordInput: $("passwordInput"), installBtn: $("installBtn")
};

let app, auth, database, stopLatestListener = null, map, marker, accuracyCircle;
let latestCoords = null, lastAddressCoords = null, lastAddressAt = 0, lastDataAt = 0;
let deferredInstallPrompt = null, toastTimer = null, chart = null;
let selectedWindowSeconds = 60;
const history = [];

function configIsReady() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("ISI_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("ISI_") &&
    firebaseConfig.appId && !firebaseConfig.appId.startsWith("ISI_");
}
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}
function setConnection(status, label) {
  els.connectionBadge.className = `status-pill ${status}`;
  els.connectionText.textContent = label;
}
function fmt(value, digits = 2) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}
function fmtAngle(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
}
function setIndicator(element, good) {
  element.className = `status-indicator ${good ? "good" : "bad"}`;
}
function initChart() {
  const ctx = $("angleChart");
  chart = new Chart(ctx, {
    type: "line",
    data: { labels: [], datasets: [
      { label: "Roll (°)", data: [], borderColor: "#b99aff", backgroundColor: "#b99aff15", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.22, fill: false },
      { label: "Pitch (°)", data: [], borderColor: "#62d9e8", backgroundColor: "#62d9e815", borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.22, fill: false }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#101a2a", borderColor: "#30415b", borderWidth: 1, titleColor: "#eaf1ff", bodyColor: "#bdcbe0", padding: 10 },
      },
      scales: {
        x: { grid: { color: "#22304755" }, ticks: { color: "#788aa5", maxTicksLimit: 6, maxRotation: 0, font: { size: 9 } }, border: { display: false } },
        y: { grid: { color: "#223047" }, ticks: { color: "#788aa5", callback: (v) => `${v}°`, font: { size: 9 } }, border: { display: false } }
      }
    }
  });
}
function initMap() {
  map = L.map("map", { zoomControl: true, scrollWheelZoom: true }).setView([-0.93157, 100.359048], 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);
}
function updateMap(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
  latestCoords = { lat, lon };
  const latlng = [lat, lon];
  if (!marker) {
    marker = L.marker(latlng).addTo(map).bindPopup("Posisi terbaru sepeda motor");
    map.setView(latlng, 16);
  } else {
    marker.setLatLng(latlng);
  }
  marker.setPopupContent(`<strong>Posisi motor</strong><br>${lat.toFixed(6)}, ${lon.toFixed(6)}`);
  els.latitudeValue.textContent = lat.toFixed(6);
  els.longitudeValue.textContent = lon.toFixed(6);
  els.googleMapsLink.href = `https://www.google.com/maps?q=${lat},${lon}`;
  els.googleMapsLink.classList.remove("disabled");
  maybeLookupAddress(lat, lon);
}
function movedEnough(a, b) {
  return !a || Math.abs(a.lat - b.lat) >= ADDRESS_MOVE_THRESHOLD_DEG || Math.abs(a.lon - b.lon) >= ADDRESS_MOVE_THRESHOLD_DEG;
}
async function maybeLookupAddress(lat, lon) {
  const now = Date.now();
  if (now - lastAddressAt < ADDRESS_MIN_INTERVAL_MS || !movedEnough(lastAddressCoords, {lat, lon})) return;
  lastAddressAt = now;
  lastAddressCoords = {lat, lon};
  els.addressStatus.textContent = "Mencari alamat…";
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const a = data.address || {};
    const village = a.village || a.suburb || a.neighbourhood || a.hamlet || a.quarter || a.residential || a.city_district || "";
    const district = a.city_district || a.district || a.county || "";
    const city = a.city || a.town || a.municipality || a.county || a.regency || "";
    const province = a.state || a.province || "";
    const country = a.country || "";
    const parts = [...new Set([village, district, city, province, country].filter(Boolean))];
    els.addressValue.textContent = parts.length ? parts.join(", ") : (data.display_name || "Alamat administratif tidak ditemukan");
    els.addressSub.textContent = [
      village ? `Desa/kelurahan: ${village}` : "",
      district ? `Kecamatan/wilayah: ${district}` : "",
      city ? `Kabupaten/kota: ${city}` : "",
      province ? `Provinsi: ${province}` : "",
      country ? `Negara: ${country}` : ""
    ].filter(Boolean).join(" · ") || "Data wilayah belum tersedia";
    els.addressStatus.textContent = "Dari OpenStreetMap";
  } catch (error) {
    els.addressStatus.textContent = "Tidak tersedia";
    els.addressSub.textContent = "Alamat gagal dimuat. Koordinat GPS tetap dapat digunakan.";
    console.warn("Reverse geocoding gagal:", error);
  }
}
function updateAngleVisuals(roll, pitch) {
  els.rollNeedle.style.transform = `rotate(${Math.max(-60, Math.min(60, roll))}deg)`;
  const h = Math.min(32, Math.abs(pitch) / 60 * 32);
  els.pitchBar.style.height = `${h}px`;
  els.pitchBar.style.top = pitch >= 0 ? `calc(50% - ${h}px)` : "50%";
  els.pitchBar.style.background = pitch >= 0 ? "#62d9e8" : "#ffca78";
}
function addChartPoint(roll, pitch, timestamp) {
  if (!Number.isFinite(roll) || !Number.isFinite(pitch)) return;
  history.push({ t: timestamp, roll, pitch });
  const cutoff = timestamp - MAX_HISTORY_SECONDS * 1000;
  while (history.length && history[0].t < cutoff) history.shift();
  renderChart();
}
function renderChart() {
  if (!chart) return;
  const cutoff = Date.now() - selectedWindowSeconds * 1000;
  const visible = history.filter((p) => p.t >= cutoff);
  chart.data.labels = visible.map((p) => new Date(p.t).toLocaleTimeString("id-ID", {hour:"2-digit", minute:"2-digit", second:"2-digit"}));
  chart.data.datasets[0].data = visible.map((p) => p.roll);
  chart.data.datasets[1].data = visible.map((p) => p.pitch);
  chart.update("none");
}
function handleLatestData(data) {
  if (!data || typeof data !== "object") {
    setConnection("waiting", "Menunggu data");
    return;
  }
  lastDataAt = Date.now();
  els.lastUpdated.textContent = new Date(lastDataAt).toLocaleTimeString("id-ID");
  setConnection("connected", "Firebase terhubung");

  const roll = Number(data.roll);
  const pitch = Number(data.pitch);
  const speed = Number(data.speed ?? data.speedKmph ?? data.speedKmh);
  els.rollValue.textContent = fmtAngle(roll);
  els.pitchValue.textContent = fmtAngle(pitch);
  els.rollLarge.innerHTML = `${fmtAngle(roll)}<small>°</small>`;
  els.pitchLarge.innerHTML = `${fmtAngle(pitch)}<small>°</small>`;
  els.speedValue.textContent = fmt(speed, 1);
  if (Number.isFinite(roll) && Number.isFinite(pitch)) {
    updateAngleVisuals(roll, pitch);
    addChartPoint(roll, pitch, lastDataAt);
  }
  const gpsStatus = String(data.gpsStatus ?? "TIDAK DIKETAHUI");
  const gpsConnected = /terhubung|connected|valid|fix/i.test(gpsStatus);
  els.gpsValue.textContent = gpsStatus.toUpperCase();
  els.gpsFoot.textContent = Number.isFinite(Number(data.satellites)) ? `${data.satellites} satelit` : "Status dari modul GPS";
  els.gpsStatusDetail.textContent = gpsStatus.toUpperCase();
  setIndicator(els.gpsIndicator, gpsConnected);

  const buzzer = data.buzzer === true || data.buzzer === 1 || String(data.buzzer).toLowerCase() === "true";
  els.buzzerStatus.textContent = buzzer ? "AKTIF" : "NONAKTIF";
  setIndicator(els.buzzerIndicator, !buzzer);
  els.counterValue.textContent = data.counter ?? "—";

  for (const [key, id] of [["ax","axValue"],["ay","ayValue"],["az","azValue"],["gx","gxValue"],["gy","gyValue"],["gz","gzValue"]]) {
    els[id].textContent = fmt(data[key], 3);
  }
  const lat = Number(data.latitude), lon = Number(data.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) updateMap(lat, lon);
  else if (data.latitude == null || data.longitude == null) {
    els.latitudeValue.textContent = "—"; els.longitudeValue.textContent = "—";
  }
}
function connectRealtimeData() {
  if (stopLatestListener) stopLatestListener();
  setConnection("waiting", "Menghubungkan…");
  const latestRef = ref(database, DATA_PATH);
  stopLatestListener = onValue(latestRef, (snapshot) => handleLatestData(snapshot.val()), (error) => {
    console.error("Firebase listener error:", error);
    setConnection("error", "Gagal membaca data");
    showToast("Gagal membaca Firebase. Periksa Rules dan izin akun.");
  });
}
function showLogin() {
  if (!els.loginDialog.open) els.loginDialog.showModal();
}
async function handleLogin(event) {
  event.preventDefault();
  if (!configIsReady()) {
    els.loginError.textContent = "Isi firebaseConfig Web App di script.js terlebih dahulu.";
    return;
  }
  els.loginError.textContent = "";
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = "Menghubungkan…";
  try {
    await signInWithEmailAndPassword(auth, els.emailInput.value.trim(), els.passwordInput.value);
    els.passwordInput.value = "";
    els.loginDialog.close();
    showToast("Login berhasil.");
  } catch (error) {
    console.error(error);
    els.loginError.textContent = error.code === "auth/invalid-credential" || error.code === "auth/wrong-password"
      ? "Email atau password tidak benar."
      : `Login gagal: ${error.message}`;
  } finally {
    els.loginSubmit.disabled = false;
    els.loginSubmit.textContent = "Masuk dan hubungkan";
  }
}
function setupPWA() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./service-worker.js").catch((e) => console.warn("Service worker gagal:", e));
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installBtn.hidden = false;
  });
  els.installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showToast("Gunakan menu browser: Tambahkan ke Layar Utama / Install App.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    els.installBtn.hidden = true;
    showToast("MotorWatch berhasil dipasang.");
  });
}
function setupControls() {
  document.querySelectorAll(".range-btn").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
    button.classList.add("active");
    selectedWindowSeconds = Number(button.dataset.window);
    renderChart();
  }));
  $("recenterBtn").addEventListener("click", () => {
    if (latestCoords && map) map.setView([latestCoords.lat, latestCoords.lon], 17, {animate:true});
    else showToast("Koordinat GPS belum tersedia.");
  });
  $("copyCoordsBtn").addEventListener("click", async () => {
    if (!latestCoords) return showToast("Koordinat GPS belum tersedia.");
    const text = `${latestCoords.lat.toFixed(6)}, ${latestCoords.lon.toFixed(6)}`;
    try { await navigator.clipboard.writeText(text); showToast("Koordinat berhasil disalin."); }
    catch { showToast(text); }
  });
  els.loginForm.addEventListener("submit", handleLogin);
}
function startStaleChecker() {
  setInterval(() => {
    if (!lastDataAt) return;
    const stale = Date.now() - lastDataAt > STALE_AFTER_MS;
    els.freshStatus.textContent = stale ? "DATA TERLAMBAT" : "TERBARU";
    setIndicator(els.freshIndicator, !stale);
    if (stale) setConnection("error", "Data terlambat");
    else if (auth?.currentUser) setConnection("connected", "Firebase terhubung");
  }, 2000);
}
function boot() {
  initChart();
  initMap();
  setupControls();
  setupPWA();
  startStaleChecker();
  if (!configIsReady()) {
    setConnection("waiting", "Konfigurasi diperlukan");
    showLogin();
    els.loginError.textContent = "Isi firebaseConfig Web App di script.js terlebih dahulu.";
    return;
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);
  onAuthStateChanged(auth, (user) => {
    if (user) connectRealtimeData();
    else {
      if (stopLatestListener) { stopLatestListener(); stopLatestListener = null; }
      setConnection("waiting", "Login diperlukan");
      showLogin();
    }
  });
}
boot();
