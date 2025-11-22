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
        
        .combined-card {
            position: fixed;
            top: 10px;
            right: 10px;
            background-color: white;
            padding: 10px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 999;
            width: 220px;
        }
        
        .refresh-timer {
            padding: 8px;
            border-bottom: 1px solid #eee;
            margin-bottom: 10px;
            font-size: 14px;
            color: #333;
            text-align: center;
        }
        
        .refresh-timer strong {
            color: #3498db;
        }
        
        .search-section input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 5px;
            font-size: 14px;
            box-sizing: border-box;
        }
        
        .search-section input:focus {
            outline: none;
            border-color: #3498db;
        }
        
        .search-results {
            margin-top: 8px;
            max-height: 80px;
            overflow-y: auto;
            border-top: 1px solid #eee;
            padding-top: 5px;
        }
        
        .search-results:empty {
            display: none;
        }
        
        .search-result-item {
            padding: 8px;
            cursor: pointer;
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 4px;
            background-color: #f8f9fa;
            transition: background-color 0.2s;
        }
        
        .search-result-item:hover {
            background-color: #e9ecef;
        }
        
        .search-result-item strong {
            color: #3498db;
        }
        
        .search-results::-webkit-scrollbar {
            width: 6px;
        }
        
        .search-results::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 3px;
        }
        
        .search-results::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 3px;
        }
        
        .search-results::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
        
        .popup-content { font-size: 13px; line-height: 1.4; }
        .popup-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
        .popup-label { font-weight: bold; color: #555; }
    </style>
</head>
<body>
 
    <div id="loadingCard" class="loading-card">
        <div class="spinner"></div>
        <div>Učitavanje...</div>
    </div>
    
    <div class="combined-card">
        <div class="refresh-timer">
            Sledeće ažuriranje za: <strong id="timer">65</strong>s
        </div>
        <div class="search-section">
            <input type="text" id="searchInput" placeholder="Pretraži vozilo...">
            <div id="searchResults" class="search-results"></div>
        </div>
    </div>
 
    <div id="map"></div>
 
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="/app.min.js"></script>
    <script>
        // Samo pozivamo init funkciju - sva logika je u app.min.js
        initApp();
    </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
}
