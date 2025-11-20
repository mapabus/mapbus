export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>GSP Live (Anti-Cache)</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: sans-serif; overflow: hidden; background: #eee; }
        #map { height: 100vh; width: 100%; z-index: 1; }
 
        /* KONTROLE */
        .controls {
            position: absolute; top: 10px; right: 10px; z-index: 1000;
            background: rgba(255, 255, 255, 0.98); padding: 15px;
            border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            width: 260px; max-height: 70vh; overflow-y: auto;
        }
 
        h3 { margin: 0 0 10px 0; color: #333; font-size: 16px; display:flex; justify-content:space-between; }
        .badge { background: #e74c3c; color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
 
        .input-group { display: flex; gap: 5px; margin-bottom: 10px; }
        input { flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 6px; outline: none; font-size: 16px; }
        button#addBtn { padding: 0 15px; background: #2980b9; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 18px; }
 
        #activeLines { list-style: none; padding: 0; margin: 0; }
        .line-item {
            background: #f8f9fa; margin-bottom: 6px; padding: 8px 12px; border-radius: 6px;
            border-left: 5px solid #95a5a6; 
            display: flex; justify-content: space-between; align-items: center; 
            font-weight: 600; font-size: 14px;
        }
        .remove-btn { color: #e74c3c; font-size: 20px; line-height: 1; padding-left: 10px; }
 
        .status-bar { margin-top: 10px; font-size: 11px; color: #666; border-top: 1px solid #eee; padding-top: 8px; }
 
        /* MARKERI */
        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 44px; height: 44px; transition: all 0.3s ease; }
 
        .bus-circle {
            width: 32px; height: 32px; border-radius: 50%; 
            color: white; 
            display: flex; justify-content: center; align-items: center;
            font-weight: bold; font-size: 13px;
            border: 2px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
            z-index: 20;
        }
 
        /* Strelica */
        .bus-arrow {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10;
            transition: transform 0.5s linear;
        }
        .arrow-head {
            width: 0; height: 0; 
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 12px solid #333;
            position: absolute; top: 0px; left: 50%; transform: translateX(-50%);
        }
 
        /* POPUP STIL */
        .popup-content { font-size: 13px; line-height: 1.4; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; }
 
    </style>
</head>
<body>
 
    <div class="controls">
        <h3>GSP Live <span class="badge">Force-Refresh</span></h3>
 
        <div class="input-group">
            <input type="number" id="lineInput" placeholder="Linija (npr. 31)" onkeypress="handleEnter(event)">
            <button id="addBtn" onclick="dodajLiniju()">+</button>
        </div>
 
        <ul id="activeLines"></ul>
 
        <div class="status-bar">
            Osvežavanje za: <b><span id="countdown">--</span>s</b><br>
            <span id="statusText">Unesi liniju...</span>
        </div>
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
        // ================= PODEŠAVANJA =================
        const map = L.map('map', { zoomControl: false }).setView([44.8125, 20.4612], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO'
        }).addTo(map);
 
        L.control.zoom({ position: 'bottomright' }).addTo(map);
 
        const busLayer = L.layerGroup().addTo(map);
 
        const BASE_URL = 'https://rt.buslogic.baguette.pirnet.si/beograd/rt.json';
 
        let izabraneLinije = [];
        let timerId = null;
        let countdownId = null;
        let refreshTime = 60; // 👈 PROMENJENA VREDNOST SA 15 NA 60 SEKUNDI
 
        let timeLeft = 0;
 
        // Istorija za smer
        let vehicleHistory = {};
 
        // Mapa boja za smerove
        let directionColorMap = {};
 
        // Paleta boja
        const colors = [
            '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', 
            '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
            '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
        ];
 
        // ================= LOGIKA =================
 
        async function osveziPodatke() {
            if (izabraneLinije.length === 0) {
                busLayer.clearLayers();
                startTimer(0); 
                return;
            }
 
            document.getElementById('statusText').innerText = "Preuzimam...";
            document.getElementById('statusText').style.color = "#e67e22";
 
            try {
                const timestamp = Date.now();
                const randomSalt = Math.random().toString(36).substring(2, 15);
                const targetUrl = `${BASE_URL}?_=${timestamp}&salt=${randomSalt}`;
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
 
                const response = await fetch(proxyUrl, { 
                    method: 'GET',
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache, no-store, must-revalidate',
                        'Pragma': 'no-cache',
                        'Expires': '0'
                    }
                });
 
                if (!response.ok) throw new Error("Greška mreže");
                const data = await response.json();
 
                if (data && data.entity) {
                    crtajVozila(data.entity);
                    const timeStr = new Date().toLocaleTimeString();
                    document.getElementById('statusText').innerHTML = `Ažurirano: <b>${timeStr}</b>`;
                    document.getElementById('statusText').style.color = "#27ae60";
                }
            } catch (error) {
                console.error(error);
                document.getElementById('statusText').innerText = "Pokušavam ponovo...";
                document.getElementById('statusText').style.color = "red";
            }
 
            startTimer(refreshTime);
        }
 
        function crtajVozila(entiteti) {
            busLayer.clearLayers();
 
            let tripDestinations = {};
            entiteti.forEach(e => {
                if (e.tripUpdate && e.tripUpdate.trip && e.tripUpdate.stopTimeUpdate) {
                    const updates = e.tripUpdate.stopTimeUpdate;
                    if (updates.length > 0) {
                        tripDestinations[e.tripUpdate.trip.tripId] = updates[updates.length - 1].stopId;
                    }
                }
            });
 
            const vozila = entiteti.filter(e => {
                if (!e.vehicle || !e.vehicle.position) return false;
                const routeId = parseInt(e.vehicle.trip.routeId).toString();
                return izabraneLinije.includes(routeId);
            });
 
            vozila.forEach(v => {
                const id = v.vehicle.vehicle.id || v.id;
                const label = v.vehicle.vehicle.label;
                const route = parseInt(v.vehicle.trip.routeId).toString();
                const tripId = v.vehicle.trip.tripId;
                const startTime = v.vehicle.trip.startTime || "N/A";
                const lat = v.vehicle.position.latitude;
                const lon = v.vehicle.position.longitude;
 
                const destId = tripDestinations[tripId] || "Unknown";
                const uniqueDirKey = `${route}_${destId}`;
 
                if (!directionColorMap[uniqueDirKey]) {
                    const nextColorIndex = Object.keys(directionColorMap).length % colors.length;
                    directionColorMap[uniqueDirKey] = colors[nextColorIndex];
                }
                const color = directionColorMap[uniqueDirKey];
 
                let rotation = 0;
                let hasAngle = false;
 
                if (vehicleHistory[id]) {
                    const prev = vehicleHistory[id];
                    const diffLat = lat - prev.lat;
                    const diffLon = lon - prev.lon;
                    const distance = Math.sqrt(diffLat * diffLat + diffLon * diffLon);
 
                    if (distance > 0.00001) { 
                        rotation = calculateBearing(prev.lat, prev.lon, lat, lon);
                        hasAngle = true;
                        console.log(`Vozilo ${route} (${id}) se pomerilo: ${distance.toFixed(6)}°, ugao: ${rotation.toFixed(1)}°`);
                    } else {
                        rotation = prev.angle;
                        hasAngle = prev.hasAngle;
                    }
                } else {
                    console.log(`Vozilo ${route} (${id}) se pojavljuje prvi put na ${lat}, ${lon}`);
                }
 
                vehicleHistory[id] = { 
                    lat: lat, 
                    lon: lon, 
                    angle: rotation,
                    hasAngle: hasAngle 
                };
 
                const arrowDisplay = hasAngle ? 'block' : 'none';
 
                const iconHtml = `
                    <div class="bus-wrapper">
                        <div class="bus-arrow" style="transform: rotate(${rotation}deg); display: ${arrowDisplay};">
                            <div class="arrow-head" style="border-bottom-color: ${color}; filter: brightness(0.6);"></div>
                        </div>
                        <div class="bus-circle" style="background: ${color};">
                            ${route}
                        </div>
                    </div>
                `;
 
                const icon = L.divIcon({
                    className: 'bus-icon-container',
                    html: iconHtml,
                    iconSize: [44, 44],
                    iconAnchor: [22, 22]
                });
 
                const popupContent = `
                    <div class="popup-content">
                        <div class="popup-row"><span class="popup-label">Linija:</span> <b>${route}</b></div>
                        <div class="popup-row"><span class="popup-label">Garažni:</span> ${label}</div>
                        <hr style="margin: 5px 0; border-color:#eee;">
                        <div class="popup-row"><span class="popup-label">Polazak:</span> <b>${startTime}</b></div>
                        <div class="popup-row"><span class="popup-label">Smer ID:</span> <span style="color:${color}; font-weight:bold;">${destId}</span></div>
                        <div class="popup-row"><span class="popup-label">Ugao:</span> ${rotation.toFixed(1)}°</div>
                    </div>
                `;
 
                L.marker([lat, lon], {icon: icon})
                    .bindPopup(popupContent)
                    .addTo(busLayer);
            });
        }
 
        function calculateBearing(startLat, startLng, destLat, destLng) {
            const y = Math.sin((destLng - startLng) * Math.PI / 180) * Math.cos(destLat * Math.PI / 180);
            const x = Math.cos(startLat * Math.PI / 180) * Math.sin(destLat * Math.PI / 180) -
                      Math.sin(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.cos((destLng - startLng) * Math.PI / 180);
            const brng = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            return brng;
        }
 
        // ================= UI =================
 
        function dodajLiniju() {
            const input = document.getElementById('lineInput');
            const val = input.value.trim();
 
            if (!val) return;
            if (izabraneLinije.length >= 5) { alert("Maksimalno 5 linija!"); return; }
            if (izabraneLinije.includes(val)) { input.value = ''; return; }
 
            izabraneLinije.push(val);
            azurirajListu();
            input.value = '';
            input.focus();
 
            osveziPodatke();
        }
 
        function ukloniLiniju(linija) {
            izabraneLinije = izabraneLinije.filter(l => l !== linija);
            azurirajListu();
            osveziPodatke();
        }
 
        function azurirajListu() {
            const ul = document.getElementById('activeLines');
            ul.innerHTML = '';
            izabraneLinije.forEach((l) => {
                ul.innerHTML += `
                    <li class="line-item">
                        <span>Linija ${l}</span>
                        <span class="remove-btn" onclick="ukloniLiniju('${l}')">&times;</span>
                    </li>`;
            });
        }
 
        function startTimer(seconds) {
            if (timerId) clearTimeout(timerId);
            if (countdownId) clearInterval(countdownId);
            if (seconds === 0) return;
 
            timeLeft = seconds;
            document.getElementById('countdown').innerText = timeLeft;
 
            countdownId = setInterval(() => {
                timeLeft--;
                if (timeLeft < 0) timeLeft = 0;
                document.getElementById('countdown').innerText = timeLeft;
            }, 1000);
 
            timerId = setTimeout(osveziPodatke, seconds * 1000);
        }
 
        function handleEnter(e) { if (e.key === 'Enter') dodajLiniju(); }
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
