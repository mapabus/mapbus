export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Linije</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: sans-serif; overflow: hidden; background: #eee; }
        #map { height: 100vh; width: 100%; z-index: 1; }
 

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
        .remove-btn { color: #e74c3c; font-size: 20px; line-height: 1; padding-left: 10px; cursor: pointer; }
 
        .status-bar { margin-top: 10px; font-size: 11px; color: #666; border-top: 1px solid #eee; padding-top: 8px; }
 

        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 50px; height: 56px; transition: all 0.3s ease; }
 
        .bus-circle {
            width: 32px; height: 32px; border-radius: 50%; 
            color: white; 
            display: flex; justify-content: center; align-items: center;
            font-weight: bold; font-size: 13px;
            border: 2px solid white; box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute; top: 0; left: 50%; transform: translateX(-50%);
            z-index: 20;
        }
        
        .bus-garage-label {
            position: absolute; 
            top: 36px; 
            left: 50%; 
            transform: translateX(-50%);
            font-size: 9px;
            font-weight: bold;
            color: white;
            background: rgba(0, 0, 0, 0.7);
            padding: 2px 5px;
            border-radius: 3px;
            white-space: nowrap;
            z-index: 19;
        }
 

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
 
        .popup-content { font-size: 13px; line-height: 1.4; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; }


        .destination-marker {
            width: 24px;
            height: 24px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            border: 3px solid white;
            box-shadow: 0 3px 8px rgba(0,0,0,0.4);
        }
        .destination-marker-inner {
            width: 100%;
            height: 100%;
            border-radius: 50% 50% 50% 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transform: rotate(45deg);
            color: white;
            font-weight: bold;
            font-size: 16px;
        }
 
    </style>
</head>
<body>
 
    <div class="controls">
        <h3>Sva Vozila Prijavljena na Polazak</h3>
 
        <div class="input-group">
            <input type="text" id="lineInput" placeholder="Linija (npr. 31, 860MV, 3A)" onkeypress="handleEnter(event)">
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

        const map = L.map('map', { zoomControl: false }).setView([44.8125, 20.4612], 13);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO'
        }).addTo(map);
 
        L.control.zoom({ position: 'bottomright' }).addTo(map);
 
        const busLayer = L.layerGroup().addTo(map);
        const destinationLayer = L.layerGroup().addTo(map);
        const routeLayer = L.layerGroup().addTo(map);
 
        let izabraneLinije = [];
        let timerId = null;
        let countdownId = null;
        let refreshTime = 60;
 
        let timeLeft = 0;
 

        let directionColorMap = {};


        let stationsMap = {};
 

        let routeNamesMap = {};

        let shapesData = {};
        let vehicleShapeMap = {};
        let shapeToColorMapGlobal = {};
 

        const colors = [
            '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', 
            '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
            '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
        ];


        
        function normalizeStopId(stopId) {
            if (typeof stopId === 'string' && stopId.length === 5 && stopId.startsWith('2')) {
                let normalized = stopId.substring(1);
                normalized = parseInt(normalized, 10).toString();
                return normalized;
            }
            return stopId;
        }

        function normalizeRouteId(routeId) {
            if (typeof routeId === 'string') {
                return parseInt(routeId, 10).toString();
            }
            return routeId;
        }

        function getRouteDisplayName(routeId) {
            const normalizedId = normalizeRouteId(routeId);
            return routeNamesMap[normalizedId] || normalizedId;
        }

        function calculateDistance(lat1, lon1, lat2, lon2) {
            const R = 6371e3;
            const φ1 = lat1 * Math.PI / 180;
            const φ2 = lat2 * Math.PI / 180;
            const Δφ = (lat2 - lat1) * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;

            const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                    Math.cos(φ1) * Math.cos(φ2) *
                    Math.sin(Δλ/2) * Math.sin(Δλ/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

            return R * c;
        }


        
        function findRouteId(userInput) {
            const normalized = userInput.trim().toUpperCase();
            

            if (routeNamesMap[normalized]) {
                return normalized;
            }
            

            for (const [apiId, displayName] of Object.entries(routeNamesMap)) {
                if (displayName.toUpperCase() === normalized) {
                    return apiId;
                }
            }
            

            const normalizedInput = normalizeRouteId(normalized);
            if (routeNamesMap[normalizedInput]) {
                return normalizedInput;
            }
            
            return null;
        }


        
        async function loadStations() {
            try {
                const response = await fetch('/api/stations');
                if (!response.ok) throw new Error("Greška pri učitavanju stanica");
                stationsMap = await response.json();
                console.log(\`✓ Učitano stanica: \${Object.keys(stationsMap).length}\`);
            } catch (error) {
                console.error("❌ Greška pri učitavanju stanica:", error);
            }
        }

        loadStations();


        
        async function loadRouteNames() {
            try {
                const response = await fetch('/route-mapping.json');
                if (!response.ok) throw new Error("Greška pri učitavanju naziva linija");
                const routeMapping = await response.json();
                
                console.log("✓ Učitano naziva linija:", Object.keys(routeMapping).length);
                
                routeNamesMap = routeMapping;
            } catch (error) {
                console.error("❌ Greška pri učitavanju naziva linija:", error);
            }
        }

        loadRouteNames();


        async function loadShapes() {
            try {
                const [shapesResponse, shapesGradskeResponse] = await Promise.all([
                    fetch('/api/shapes.txt'),
                    fetch('/api/shapes_gradske.txt')
                ]);
                
                const shapesText = await shapesResponse.text();
                const shapesGradskeText = await shapesGradskeResponse.text();
                
                parseShapesCSV(shapesText);
                parseShapesCSV(shapesGradskeText);
                
                console.log('✓ Shapes loaded:', Object.keys(shapesData).length);
            } catch (error) {
                console.error('❌ Error loading shapes:', error);
            }
        }

        function parseShapesCSV(csvText) {
            const lines = csvText.split('\\n');
            
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const parts = line.split(',');
                if (parts.length < 4) continue;
                
                const shapeId = parts[0];
                const lat = parseFloat(parts[1]);
                const lon = parseFloat(parts[2]);
                const sequence = parseInt(parts[3]);
                
                if (!shapesData[shapeId]) {
                    shapesData[shapeId] = [];
                }
                
                shapesData[shapeId].push({
                    lat: lat,
                    lon: lon,
                    sequence: sequence
                });
            }
            
            for (let shapeId in shapesData) {
                shapesData[shapeId].sort((a, b) => a.sequence - b.sequence);
            }
        }

        loadShapes();

        function padRouteId(routeId) {
            const numericId = parseInt(routeId, 10);
            if (!isNaN(numericId) && routeId === numericId.toString() && routeId.length <= 3) {
                return numericId.toString().padStart(5, '0');
            }
            return routeId;
        }

        function determineShapeColorByDestination(shapeKey, routeId, vehicleDestinations) {
            const shapePoints = shapesData[shapeKey];
            if (!shapePoints || shapePoints.length === 0) return '#95a5a6';
            
            const lastPoint = shapePoints[shapePoints.length - 1];
            
            let bestMatch = null;
            let minDistance = Infinity;
            
            for (const [vehicleId, destId] of Object.entries(vehicleDestinations)) {
                const normalizedDestId = normalizeStopId(destId);
                const station = stationsMap[normalizedDestId];
                
                if (station && station.coords) {
                    const distance = calculateDistance(
                        lastPoint.lat, lastPoint.lon,
                        station.coords[0], station.coords[1]
                    );
                    
                    if (distance < minDistance && distance < 500) {
                        minDistance = distance;
                        bestMatch = destId;
                    }
                }
            }
            
            if (bestMatch) {
                const uniqueDirKey = \`\${routeId}_\${bestMatch}\`;
                const color = directionColorMap[uniqueDirKey];
                if (color) {
                    console.log(\`✓ Shape \${shapeKey} obojen u \${color} (destinacija: \${bestMatch}, udaljenost: \${minDistance.toFixed(0)}m)\`);
                    return color;
                }
            }
            
            return '#95a5a6';
        }

        function drawAllRoutes(vehicleDestinations) {
            routeLayer.clearLayers();
            
            if (izabraneLinije.length === 0) return;
            
            let allBounds = [];
            
            izabraneLinije.forEach(routeId => {
                const paddedRouteId = padRouteId(routeId);
                
                let matchingShapes = [];
                for (let shapeKey in shapesData) {
                    if (shapeKey.startsWith(routeId + '_') || shapeKey.startsWith(paddedRouteId + '_')) {
                        matchingShapes.push(shapeKey);
                    }
                }
                
                console.log(\`Route \${routeId}: found \${matchingShapes.length} shapes\`);
                
                matchingShapes.forEach(shapeKey => {
                    const shapePoints = shapesData[shapeKey];
                    
                    if (!shapePoints || shapePoints.length === 0) return;
                    
                    let shapeColor = shapeToColorMapGlobal[shapeKey];
                    
                    if (!shapeColor) {
                        shapeColor = determineShapeColorByDestination(shapeKey, routeId, vehicleDestinations);
                        shapeToColorMapGlobal[shapeKey] = shapeColor;
                    }
                    
                    console.log(\`Drawing shape \${shapeKey} with color \${shapeColor}\`);
                    
                    const latLngs = shapePoints.map(point => [point.lat, point.lon]);
                    
                    const polyline = L.polyline(latLngs, {
                        color: shapeColor,
                        weight: 4,
                        opacity: 0.6,
                        smoothFactor: 1
                    });
                    
                    polyline.addTo(routeLayer);
                    allBounds.push(polyline.getBounds());
                });
            });
            
            if (allBounds.length > 0) {
                const combinedBounds = allBounds.reduce((acc, bounds) => {
                    return acc.extend(bounds);
                }, allBounds[0]);
                
                map.fitBounds(combinedBounds, {
                    padding: [50, 50]
                });
            }
        }
 

 
        async function osveziPodatke() {
            if (izabraneLinije.length === 0) {
                busLayer.clearLayers();
                destinationLayer.clearLayers();
                routeLayer.clearLayers();
                directionColorMap = {};
                shapeToColorMapGlobal = {};
                startTimer(0); 
                return;
            }
 
            document.getElementById('statusText').innerText = "Preuzimam...";
            document.getElementById('statusText').style.color = "#e67e22";
 
            try {

                const response = await fetch('/api/vehicles', { 
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
 
                if (data && data.vehicles) {

                    const vehicleDestinations = {};
                    vehicleShapeMap = {};
                    
                    data.tripUpdates.forEach(update => {
                        vehicleDestinations[update.vehicleId] = update.destination;
                        if (update.shapeId) {
                            vehicleShapeMap[update.vehicleId] = update.shapeId;
                        }
                    });
                    
                    const vozila = data.vehicles.filter(v => {
                        const routeId = normalizeRouteId(v.routeId);
                        return izabraneLinije.includes(routeId);
                    });
                    
                    vozila.forEach(v => {
                        const route = normalizeRouteId(v.routeId);
                        const vehicleId = v.id;
                        const destId = vehicleDestinations[vehicleId] || "Unknown";
                        const uniqueDirKey = \`\${route}_\${destId}\`;
                        
                        if (!directionColorMap[uniqueDirKey]) {
                            const nextColorIndex = Object.keys(directionColorMap).length % colors.length;
                            directionColorMap[uniqueDirKey] = colors[nextColorIndex];
                        }
                        
                        const shapeId = vehicleShapeMap[vehicleId];
                        if (shapeId) {
                            if (!shapeToColorMapGlobal[shapeId]) {
                                shapeToColorMapGlobal[shapeId] = directionColorMap[uniqueDirKey];
                                console.log(\`✓ Direktno mapiranje: \${shapeId} -> \${directionColorMap[uniqueDirKey]} (dest: \${destId})\`);
                            }
                        }
                    });
                    
                    console.log('Direction Color Map:', directionColorMap);
                    console.log('Vehicle Destinations:', vehicleDestinations);
                    
                    drawAllRoutes(vehicleDestinations);
                    crtajVozila(data.vehicles, vehicleDestinations);
                    
                    const timeStr = new Date().toLocaleTimeString();
                    document.getElementById('statusText').innerHTML = \`Ažurirano: <b>\${timeStr}</b>\`;
                    document.getElementById('statusText').style.color = "#27ae60";
                }
            } catch (error) {
                console.error(error);
                document.getElementById('statusText').innerText = "Pokušavam ponovo...";
                document.getElementById('statusText').style.color = "red";
            }
 
            startTimer(refreshTime);
        }
 
        function crtajVozila(vehicles, vehicleDestinations) {
            busLayer.clearLayers();
            destinationLayer.clearLayers();
 
           
            const vozila = vehicles.filter(v => {
                const routeId = normalizeRouteId(v.routeId);
                return izabraneLinije.includes(routeId);
            });

  
            let destinations = new Set();
            let destinationInfo = {};
 
            vozila.forEach(v => {
                const route = normalizeRouteId(v.routeId);
                const vehicleId = v.id;
                
                const destId = vehicleDestinations[vehicleId] || "Unknown";
                
                const normalizedId = normalizeStopId(destId);
                const uniqueDirKey = \`\${route}_\${destId}\`;
                
                const color = directionColorMap[uniqueDirKey];
                
                destinations.add(destId);
                destinationInfo[destId] = {
                    color: color,
                    normalizedId: normalizedId,
                    route: route
                };
            });

     
            destinations.forEach(destId => {
                const info = destinationInfo[destId];
                const station = stationsMap[info.normalizedId];
                
                if (station && station.coords) {
                    const destHtml = \`
                        <div class="destination-marker" style="background: \${info.color};">
                            <div class="destination-marker-inner">📍</div>
                        </div>
                    \`;
                    
                    const destIcon = L.divIcon({
                        className: 'destination-icon-container',
                        html: destHtml,
                        iconSize: [24, 24],
                        iconAnchor: [12, 24]
                    });
                    
                    const destPopup = \`
                        <div class="popup-content">
                            <div class="popup-row"><span class="popup-label">Stanica:</span> <b>\${station.name}</b></div>
                            <div class="popup-row"><span class="popup-label">ID:</span> \${destId}</div>
                        </div>
                    \`;
                    
                    L.marker(station.coords, {icon: destIcon})
                        .bindPopup(destPopup)
                        .addTo(destinationLayer);
                }
            });
 

            vozila.forEach(v => {
                const id = v.id;
                const label = v.label;
                const route = normalizeRouteId(v.routeId);
                const routeDisplayName = getRouteDisplayName(v.routeId);
                const startTime = v.startTime || "N/A";
                const lat = v.lat;
                const lon = v.lon;
 
                const destId = vehicleDestinations[id] || "Unknown";
                const normalizedId = normalizeStopId(destId);
                const station = stationsMap[normalizedId];
                const destName = station ? station.name : destId;
                
                const uniqueDirKey = \`\${route}_\${destId}\`;
                const color = directionColorMap[uniqueDirKey];
 
                let rotation = 0;
                let hasAngle = false;

                if (station && station.coords) {
                    rotation = calculateBearing(lat, lon, station.coords[0], station.coords[1]);
                    hasAngle = true;
                }
 
                const arrowDisplay = hasAngle ? 'block' : 'none';
 
                const iconHtml = \`
                    <div class="bus-wrapper">
                        <div class="bus-arrow" style="transform: rotate(\${rotation}deg); display: \${arrowDisplay};">
                            <div class="arrow-head" style="border-bottom-color: \${color}; filter: brightness(0.6);"></div>
                        </div>
                        <div class="bus-circle" style="background: \${color};">
                            \${routeDisplayName}
                        </div>
                        <div class="bus-garage-label">\${label}</div>
                    </div>
                \`;
 
                const icon = L.divIcon({
                    className: 'bus-icon-container',
                    html: iconHtml,
                    iconSize: [50, 56],
                    iconAnchor: [25, 28]
                });
 
                const popupContent = \`
                    <div class="popup-content">
                        <div class="popup-row"><span class="popup-label">Linija:</span> <b>\${routeDisplayName}</b></div>
                        <div class="popup-row"><span class="popup-label">Garažni:</span> \${label}</div>
                        <hr style="margin: 5px 0; border-color:#eee;">
                        <div class="popup-row"><span class="popup-label">Polazak:</span> <b>\${startTime}</b></div>
                        <div class="popup-row"><span class="popup-label">Smer (ide ka):</span> <span style="color:\${color}; font-weight:bold;">\${destName}</span></div>
                    </div>
                \`;
 
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
 

 
        function dodajLiniju() {
            const input = document.getElementById('lineInput');
            const val = input.value.trim();

            if (!val) return;
            if (izabraneLinije.length >= 10) { 
                alert("Maksimalno 10 linija!"); 
                return; 
            }
            

            const routeId = findRouteId(val);
            if (!routeId) {
                alert(\`Linija "\${val}" nije pronađena! Pokušaj sa drugim nazivom.\`);
                input.value = '';
                return;
            }
            
            if (izabraneLinije.includes(routeId)) { 
                alert("Linija je već dodata!");
                input.value = ''; 
                return; 
            }

            izabraneLinije.push(routeId);
            azurirajListu();
            input.value = '';
            input.focus();

            osveziPodatke();
        }
 
        function ukloniLiniju(linija) {
            izabraneLinije = izabraneLinije.filter(l => l !== linija);
            
            const keysToRemove = [];
            for (let key in directionColorMap) {
                if (key.startsWith(linija + '_')) {
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(key => delete directionColorMap[key]);
            
            for (let shapeKey in shapeToColorMapGlobal) {
                if (shapeKey.startsWith(linija + '_') || shapeKey.startsWith(padRouteId(linija) + '_')) {
                    delete shapeToColorMapGlobal[shapeKey];
                }
            }
            
            azurirajListu();
            osveziPodatke();
        }
 
        function azurirajListu() {
            const ul = document.getElementById('activeLines');
            ul.innerHTML = '';
            izabraneLinije.forEach((l) => {
                const displayName = getRouteDisplayName(l);
                ul.innerHTML += \`
                    <li class="line-item">
                        <span>Linija \${displayName}</span>
                        <span class="remove-btn" onclick="ukloniLiniju('\${l}')">✖</span>
                    </li>
                \`;
            });
        }

        function handleEnter(event) {
            if (event.key === 'Enter') {
                dodajLiniju();
            }
        }

        function startTimer(seconds) {
            if (timerId) clearTimeout(timerId);
            if (countdownId) clearInterval(countdownId);
            
            if (seconds === 0) {
                document.getElementById('countdown').innerText = '--';
                return;
            }
            
            timeLeft = seconds;
            document.getElementById('countdown').innerText = timeLeft;
            
            countdownId = setInterval(() => {
                timeLeft--;
                document.getElementById('countdown').innerText = timeLeft;
                if (timeLeft <= 0) {
                    clearInterval(countdownId);
                }
            }, 1000);
            
            timerId = setTimeout(() => {
                osveziPodatke();
            }, seconds * 1000);
        }
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
