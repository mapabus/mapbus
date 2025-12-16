export async function onRequest(context) {
  const html = `
<!DOCTYPE html>
<html lang="sr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sva Vozila</title>
    
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; overflow: hidden; }
        
        #map { height: 100vh; width: 100%; }
        
        .loading-card {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px 50px;
            border-radius: 15px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            z-index: 2000;
            text-align: center;
        }
        
        .loading-card.hidden { display: none; }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .search-box {
            position: absolute;
            top: 20px;
            left: 20px;
            z-index: 1000;
            background: white;
            padding: 15px;
            border-radius: 10px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            width: 300px;
        }
        
        .search-box input {
            width: 100%;
            padding: 10px;
            border: 2px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.3s;
        }
        
        .search-box input:focus {
            border-color: #3498db;
        }
        
        #searchResults {
            margin-top: 10px;
            max-height: 200px;
            overflow-y: auto;
        }
        
        .search-result-item {
            padding: 10px;
            cursor: pointer;
            border-radius: 5px;
            margin-bottom: 5px;
            background: #f8f9fa;
            transition: background 0.2s;
        }
        
        .search-result-item:hover {
            background: #e9ecef;
        }
        
        .bus-icon-container { background: none; border: none; }
        .bus-wrapper { position: relative; width: 50px; height: 56px; transition: all 0.3s ease; }
        
        .bus-circle {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            color: white;
            display: flex;
            justify-content: center;
            align-items: center;
            font-weight: bold;
            font-size: 13px;
            border: 2px solid white;
            box-shadow: 0 3px 6px rgba(0,0,0,0.4);
            position: absolute;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
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
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10;
            transition: transform 0.5s linear;
        }
        
        .arrow-head {
            width: 0;
            height: 0;
            border-left: 7px solid transparent;
            border-right: 7px solid transparent;
            border-bottom: 12px solid #333;
            position: absolute;
            top: 0px;
            left: 50%;
            transform: translateX(-50%);
        }
        
        .popup-content { font-size: 13px; line-height: 1.6; }
        .popup-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
        }
        .popup-label { font-weight: bold; color: #555; margin-right: 10px; }
    </style>
</head>
<body>
    <div id="loadingCard" class="loading-card">
        <div class="spinner"></div>
        <p>Učitavanje vozila...</p>
    </div>
    
    <div class="search-box">
        <input type="text" id="searchInput" placeholder="Pretraži vozilo (garažni broj)..." />
        <div id="searchResults"></div>
    </div>
    
    <div id="map"></div>
    
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="/app.min.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            initApp();
        });
    </script>
</body>
</html>
  `;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
