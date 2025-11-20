export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sva Vozila</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #map { height: 100vh; width: 100%; }
 
        .bus-marker {
            border-radius: 50%;
            color: white;
            font-weight: bold;
            display: flex;
            justify-content: center;
            align-items: center;
            border: 2px solid white;
            box-shadow: 0 0 4px rgba(0,0,0,0.5);
            font-size: 12px;
        }
 
        .marker-red { background-color: #e74c3c; }
        .marker-blue { background-color: #3498db; }
        .marker-gray { background-color: #95a5a6; }
        
        /* Stil za loading karticu */
        .loading-card {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: white;
            padding: 30px 40px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            text-align: center;
            z-index: 1000;
            font-size: 18px;
            color: #333;
        }
        
        .loading-card.hidden {
            display: none;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Stil za refresh tajmer */
        .refresh-timer {
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: white;
            padding: 10px 15px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 999;
            font-size: 14px;
            color: #333;
        }
        
        .refresh-timer strong {
            color: #3498db;
        }
    </style>
</head>
<body>
 
    <div id="loadingCard" class="loading-card">
        <div class="spinner"></div>
        <div>Učitavanje...</div>
    </div>
    
    <div class="refresh-timer">
        Sledeće ažuriranje za: <strong id="timer">60</strong>s
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 
    <script>
        var map = L.map('map').setView([44.8125, 20.4612], 13);
 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
 
        var markersLayer = L.layerGroup().addTo(map);
        var sviPodaci = []; 
        
        const url = '/api/proxy';
        const REFRESH_INTERVAL = 60000; // 60 sekundi
        const COUNTDOWN_START = 60; // Početak odbrojavanja
        var refreshTimer;
        var countdown;
        var remainingSeconds = COUNTDOWN_START;
 
        function ucitajAutobuse() {
            // Prikaži loading karticu
            document.getElementById('loadingCard').classList.remove('hidden');
            
            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error('Mreža nije dostupna');
                    return response.json();
                })
                .then(data => {
                    // Sakrij loading karticu
                    document.getElementById('loadingCard').classList.add('hidden');
                    
                    if (data && data.entity) {
                        sviPodaci = data.entity;
                        nacrtajMarkere();
                    }
                })
                .catch(error => {
                    console.error('Greška:', error);
                    document.getElementById('loadingCard').classList.add('hidden');
                    alert('Greška pri učitavanju podataka. Proverite konzolu.');
                });
        }
 
        function nacrtajMarkere() {
            markersLayer.clearLayers();
 
            sviPodaci.forEach(entitet => {
                if (entitet.vehicle && entitet.vehicle.position) {
 
                    var info = entitet.vehicle;
                    var trip = info.trip;
                    var routeNum = parseInt(trip.routeId);
 
                    var pos = info.position;
                    var lat = parseFloat(pos.latitude);
                    var lon = parseFloat(pos.longitude);
 
                    var markerClass = 'marker-gray';
                    if (trip.tripId && trip.tripId.includes('A_RD')) {
                        markerClass = 'marker-red';
                    } else if (trip.tripId && trip.tripId.includes('B_RD')) {
                        markerClass = 'marker-blue';
                    }
 
                    var customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: '<div class="bus-marker ' + markerClass + '" style="width: 30px; height: 30px;">' + routeNum + '</div>',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
 
                    var marker = L.marker([lat, lon], {icon: customIcon});
 
                    var popupSadrzaj = '<b>Linija:</b> ' + routeNum + '<br>' +
                                       '<b>Vozilo:</b> ' + info.vehicle.label + '<br>' +
                                       '<b>Polazak:</b> ' + trip.startTime;
                    marker.bindPopup(popupSadrzaj);
 
                    markersLayer.addLayer(marker);
                }
            });
        }
        
        function startCountdown() {
            // Očisti prethodni countdown ako postoji
            if (countdown) {
                clearInterval(countdown);
            }
            
            remainingSeconds = COUNTDOWN_START;
            document.getElementById('timer').textContent = remainingSeconds;
            
            countdown = setInterval(function() {
                remainingSeconds--;
                document.getElementById('timer').textContent = remainingSeconds;
                
                if (remainingSeconds <= 0) {
                    clearInterval(countdown);
                }
            }, 1000);
        }
        
        function startAutoRefresh() {
            refreshTimer = setInterval(function() {
                ucitajAutobuse();
                startCountdown();
            }, REFRESH_INTERVAL);
        }
 
        // Početno učitavanje
        ucitajAutobuse();
        startCountdown();
        startAutoRefresh();
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
