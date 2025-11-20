export default function handler(req, res) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GSP Beograd - Pretraga Linija</title>
 
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
 
    <style>
        body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
        #map { height: 100vh; width: 100%; }
 
        /* Stil za kontrolni panel */
        .controls {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 1000; /* Iznad mape */
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 0 15px rgba(0,0,0,0.2);
            width: 250px;
        }
 
        .controls h3 { margin-top: 0; font-size: 16px; color: #333; }
 
        .controls input, .controls select {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            box-sizing: border-box;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
 
        /* Dugme za reset */
        .btn-reset {
            width: 100%;
            padding: 8px;
            background-color: #e74c3c;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        }
        .btn-reset:hover { background-color: #c0392b; }
 
        /* Stil za kružiće */
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
 
        /* Boje */
        .marker-red { background-color: #e74c3c; }
        .marker-blue { background-color: #3498db; }
        .marker-gray { background-color: #95a5a6; }
    </style>
</head>
<body>
 
    <div class="controls">
        <h3>Izbor Linije</h3>
 
        <input type="text" id="pretragaInput" placeholder="Ukucaj broj linije (npr. 15)...">
 
        <select id="linijaSelect">
            <option value="sve">Prikaži sve linije</option>
            </select>
 
        <button class="btn-reset" onclick="resetujMapu()">Prikaži SVE autobuse</button>
        <div id="status" style="font-size: 12px; color: #666; margin-top: 5px;">Učitavanje...</div>
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 
    <script>
        // 1. INICIJALIZACIJA MAPE
        var map = L.map('map').setView([44.8125, 20.4612], 13);
 
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);
 
        // Kreiramo grupu za markere (da bismo mogli lako da ih brišemo)
        var markersLayer = L.layerGroup().addTo(map);
 
        // Globalna promenljiva za čuvanje podataka
        var sviPodaci = []; 
 
        const url = 'https://rt.buslogic.baguette.pirnet.si/beograd/rt.json';
 
        // 2. FUNKCIJA ZA DOVLAČENJE PODATAKA
        function ucitajAutobuse() {
            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error('Mreža nije dostupna');
                    return response.json();
                })
                .then(data => {
                    if (data && data.entity) {
                        sviPodaci = data.entity; // Čuvamo podatke globalno
                        popuniPadajuciMeni();    // Popunjavamo select listu
                        nacrtajMarkere('sve');   // Crtamo sve na početku
                        document.getElementById('status').innerText = `Aktivnih vozila: ${sviPodaci.length}`;
                    }
                })
                .catch(error => {
                    console.error('Greška:', error);
                    document.getElementById('status').innerText = "Greška pri učitavanju!";
                    alert('CORS Greška ili problem sa linkom. Proverite konzolu.');
                });
        }
 
        // 3. POPUNJAVANJE SELECT LISTE JEDINSTVENIM LINIJAMA
        function popuniPadajuciMeni() {
            var linijeSet = new Set();
 
            sviPodaci.forEach(entitet => {
                if (entitet.vehicle && entitet.vehicle.trip) {
                    var routeNum = parseInt(entitet.vehicle.trip.routeId);
                    linijeSet.add(routeNum);
                }
            });
 
            // Sortiramo brojeve linija (npr. 1, 2, 15, 83...)
            var sortiraneLinije = Array.from(linijeSet).sort((a, b) => a - b);
 
            var selectElement = document.getElementById('linijaSelect');
 
            sortiraneLinije.forEach(linija => {
                var option = document.createElement('option');
                option.value = linija;
                option.text = "Linija " + linija;
                selectElement.appendChild(option);
            });
        }
 
        // 4. FUNKCIJA ZA CRTANJE MARKERA (FILTRIRANJE)
        function nacrtajMarkere(filterLinija) {
            // Prvo brišemo sve stare markere sa mape
            markersLayer.clearLayers();
 
            sviPodaci.forEach(entitet => {
                if (entitet.vehicle && entitet.vehicle.position) {
 
                    var info = entitet.vehicle;
                    var trip = info.trip;
                    var routeNum = parseInt(trip.routeId); // 00014 -> 14
 
                    // FILTRIRANJE:
                    // Ako filter nije 'sve' i ako se broj linije ne poklapa, preskoči ovaj autobus
                    // Pretraga je "tekstualna" da bi input radio (npr ukucaš "1", izađu 15, 16, 1...)
                    if (filterLinija !== 'sve') {
                        // Proveravamo da li filter (string) postoji u broju linije
                        if (routeNum.toString() != filterLinija.toString()) {
                             // Ako hoćeš "pametnu pretragu" (npr kucaš "6" a izađe "65"), koristi:
                             // if (!routeNum.toString().startsWith(filterLinija.toString())) return;
                             return; 
                        }
                    }
 
                    var pos = info.position;
                    var lat = parseFloat(pos.latitude);
                    var lon = parseFloat(pos.longitude);
 
                    // Boja
                    var markerClass = 'marker-gray';
                    if (trip.tripId && trip.tripId.includes('A_RD')) {
                        markerClass = 'marker-red';
                    } else if (trip.tripId && trip.tripId.includes('B_RD')) {
                        markerClass = 'marker-blue';
                    }
 
                    var customIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="bus-marker ${markerClass}" style="width: 30px; height: 30px;">${routeNum}</div>`,
                        iconSize: [30, 30],
                        iconAnchor: [15, 15]
                    });
 
                    var marker = L.marker([lat, lon], {icon: customIcon});
 
                    var popupSadrzaj = `
                        <b>Linija:</b> ${routeNum}<br>
                        <b>Vozilo:</b> ${info.vehicle.label}<br>
                        <b>Polazak:</b> ${trip.startTime}
                    `;
                    marker.bindPopup(popupSadrzaj);
 
                    // Dodajemo marker u grupu (ne direktno na mapu)
                    markersLayer.addLayer(marker);
                }
            });
        }
 
        // 5. EVENT LISTENERS (REAKCIJE NA KLIKOVE I KUCANJE)
 
        // Kada se izabere linija iz padajućeg menija
        document.getElementById('linijaSelect').addEventListener('change', function() {
            var izabranaLinija = this.value;
            document.getElementById('pretragaInput').value = ""; // Brišemo input polje
            nacrtajMarkere(izabranaLinija);
        });
 
        // Kada se kuca u polje za pretragu
        document.getElementById('pretragaInput').addEventListener('input', function() {
            var tekst = this.value;
            document.getElementById('linijaSelect').value = 'sve'; // Resetujemo select
 
            if (tekst === "") {
                nacrtajMarkere('sve');
            } else {
                // Ovde koristimo malu trik logiku:
                // Pozivamo crtanje ali modifikovano. 
                // Ipak, da bi bilo jednostavno, ako neko ukuca "15", šaljemo "15" u filter.
                nacrtajMarkere(tekst);
            }
        });
 
        // Dugme za reset
        function resetujMapu() {
            document.getElementById('pretragaInput').value = "";
            document.getElementById('linijaSelect').value = "sve";
            nacrtajMarkere('sve');
        }
 
        // Pokretanje
        ucitajAutobuse();
 
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
