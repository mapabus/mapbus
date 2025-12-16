export async function onRequest(context) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
<script src="/auth-check.js"></script>
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
            <input type="text" id="lineInput" placeholder="Linija (npr.31, 860MV, 3A)" onkeypress="handleEnter(event)">
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
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO, &copy; OpenStreetMap contributors',
            maxZoom: 20
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
                    fetch('/data/shapes.txt'),
                    fetch('/data/shapes_gradske.txt')
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
              const station = stationsMap[normalizeStopId(destId)];
              if (!station || !station.coords) continue;
              
              const [destLat, destLon] = station.coords;
              const dist = calculateDistance(lastPoint.lat, lastPoint.lon, destLat, destLon);
              
              if (dist < minDistance) {
                minDistance = dist;
                bestMatch = destId;
              }
            }
            
            if (bestMatch && minDistance < 100) { // Prag od 100m
              return getColorForDirection(routeId, bestMatch);
            }
            
            return '#95a5a6';
        }

        function getColorForDirection(routeId, direction) {
            const key = \`\${routeId}_\${direction}\`;
            if (!directionColorMap[key]) {
                directionColorMap[key] = colors[Object.keys(directionColorMap).length % colors.length];
            }
            return directionColorMap[key];
        }

        async function ucitajVozila() {
            try {
                busLayer.clearLayers();
                destinationLayer.clearLayers();
                routeLayer.clearLayers();
                shapeToColorMapGlobal = {};
                vehicleShapeMap = {};

                document.getElementById('statusText').innerText = 'Učitavam podatke...';
                document.getElementById('countdown').innerText = '--';
                clearInterval(countdownId);

                if (izabraneLinije.length === 0) {
                    document.getElementById('statusText').innerText = 'Unesi liniju...';
                    return;
                }

                const linesQuery = izabraneLinije.join(',');
                const response = await fetch(\`/api/vehicles?lines=\${linesQuery}\`);
                if (!response.ok) throw new Error('Greška pri učitavanju vozila');

                const data = await response.json();
                if (!data.vehicles || data.vehicles.length === 0) {
                    document.getElementById('statusText').innerText = 'Nema vozila na linijama';
                    return;
                }

                const vehicleDestinations = {};
                if (data.tripUpdates) {
                    data.tripUpdates.forEach(update => {
                        vehicleDestinations[update.vehicleId] = update.destination;
                    });
                }

                const bounds = L.latLngBounds([]);

                for (const vehicle of data.vehicles) {
                    const routeId = normalizeRouteId(vehicle.routeId);
                    const destId = vehicleDestinations[vehicle.id] || "Unknown";
                    const normalizedId = normalizeStopId(destId);
                    const station = stationsMap[normalizedId];
                    const destName = station ? station.name : destId;
                    const destCoords = station ? station.coords : null;

                    const routeDisplayName = getRouteDisplayName(routeId);
                    const color = colors[izabraneLinije.indexOf(routeId) % colors.length];

                    const busIcon = L.divIcon({
                        html: \`
                            <div class="bus-wrapper">
                                <div class="bus-circle" style="background: \${color}">
                                    \${routeDisplayName}
                                </div>
                                <div class="bus-garage-label">\${vehicle.label}</div>
                                <div class="bus-arrow" style="transform: rotate(\${vehicle.bearing || 0}deg);">
                                    <div class="arrow-head" style="border-bottom-color: \${color};"></div>
                                </div>
                            </div>
                        \`,
                        className: 'bus-icon-container',
                        iconSize: [50, 56],
                        iconAnchor: [25, 28]
                    });

                    const marker = L.marker([vehicle.lat, vehicle.lon], { icon: busIcon }).addTo(busLayer);

                    const popupContent = \`
                        <div class="popup-content">
                            <div class="popup-row">
                                <span class="popup-label">Vozilo:</span> \${vehicle.label}
                            </div>
                            <div class="popup-row">
                                <span class="popup-label">Linija:</span> \${routeDisplayName}
                            </div>
                            <div class="popup-row">
                                <span class="popup-label">Polazak:</span> \${vehicle.startTime || 'N/A'}
                            </div>
                            <div class="popup-row">
                                <span class="popup-label">Smer:</span> \${destName}
                            </div>
                        </div>
                    \`;

                    marker.bindPopup(popupContent, {
                        maxWidth: 220,
                        minWidth: 200,
                        className: 'custom-popup'
                    });

                    bounds.extend([vehicle.lat, vehicle.lon]);

                    if (destCoords) {
                        const destIcon = L.divIcon({
                            html: \`
                                <div class="destination-marker" style="background: \${color}">
                                    <div class="destination-marker-inner">\${routeDisplayName}</div>
                                </div>
                            \`,
                            className: '',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        });

                        const destMarker = L.marker(destCoords, { icon: destIcon }).addTo(destinationLayer);
                        destMarker.bindPopup(`Smer: \${destName}<br>Linija: \${routeDisplayName}`);
                        bounds.extend(destCoords);
                    }

                    // Dodaj trasu
                    const shapeKey = padRouteId(routeId);
                    const shapeColor = determineShapeColorByDestination(shapeKey, routeId, vehicleDestinations);
                    const shapePoints = shapesData[shapeKey];

                    if (shapePoints) {
                        const polylinePoints = shapePoints.map(p => [p.lat, p.lon]);
                        const polyline = L.polyline(polylinePoints, { 
                            color: shapeColor, 
                            weight: 4, 
                            opacity: 0.8 
                        }).addTo(routeLayer);
                        bounds.extend(polyline.getBounds());
                    } else {
                        console.warn(\`No shape for route \${routeId}\`);
                    }

                    vehicleShapeMap[vehicle.id] = shapeKey;
                    shapeToColorMapGlobal[shapeKey] = shapeColor;
                }

                if (bounds.isValid()) {
                    map.fitBounds(bounds, { padding: [50, 50] });
                }

                document.getElementById('statusText').innerText = \`Vozila: \${data.vehicles.length}\`;
                startCountdown();

            } catch (error) {
                document.getElementById('statusText').innerText = 'Greška pri učitavanju';
                console.error(error);
            }
        }

        function startCountdown() {
            timeLeft = refreshTime;
            document.getElementById('countdown').innerText = timeLeft;
            
            countdownId = setInterval(() => {
                timeLeft--;
                document.getElementById('countdown').innerText = timeLeft;
                
                if (timeLeft <= 0) {
                    clearInterval(countdownId);
                    ucitajVozila();
                }
            }, 1000);
        }

        function dodajLiniju() {
            const input = document.getElementById('lineInput');
            const value = input.value.trim();
            if (!value) return;

            const routeId = findRouteId(value);
            if (!routeId) {
                alert('Nepoznata linija!');
                return;
            }

            if (izabraneLinije.includes(routeId)) return;

            izabraneLinije.push(routeId);

            const list = document.getElementById('activeLines');
            const item = document.createElement('li');
            item.className = 'line-item';
            item.style.borderLeftColor = colors[izabraneLinije.length - 1 % colors.length];
            item.innerHTML = \`
                \${getRouteDisplayName(routeId)}
                <span class="remove-btn" onclick="ukloniLiniju('\${routeId}', this)">×</span>
            \`;
            list.appendChild(item);

            input.value = '';

            if (izabraneLinije.length === 1) {
                ucitajVozila();
                timerId = setInterval(ucitajVozila, refreshTime * 1000);
            } else {
                ucitajVozila();
            }
        }

        function ukloniLiniju(routeId, element) {
            izabraneLinije = izabraneLinije.filter(l => l !== routeId);
            element.parentElement.remove();

            if (izabraneLinije.length === 0) {
                clearInterval(timerId);
                clearInterval(countdownId);
                busLayer.clearLayers();
                destinationLayer.clearLayers();
                routeLayer.clearLayers();
                document.getElementById('statusText').innerText = 'Unesi liniju...';
                document.getElementById('countdown').innerText = '--';
            } else {
                ucitajVozila();
            }
        }

        function handleEnter(event) {
            if (event.key === 'Enter') {
                dodajLiniju();
            }
        }

    </script>
</body>
</html>
  `;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}