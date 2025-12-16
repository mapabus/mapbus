export async function onRequest(context) {
  const html = `<!DOCTYPE html>
<html lang="sr">
<head>
    <script src="/auth-check.js"></script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Baza Vozila</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 1600px;
            margin: 0 auto;
        }

        .header {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 15px;
        }

        h1 {
            color: #333;
            font-size: 28px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .subtitle {
            color: #666;
            font-size: 14px;
            margin-top: 5px;
        }

        .stats {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }

        .stat-box {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            text-align: center;
            min-width: 120px;
        }

        .stat-number {
            font-size: 32px;
            font-weight: bold;
            display: block;
        }

        .stat-label {
            font-size: 12px;
            opacity: 0.9;
        }

        .info-banner {
            background: #e3f2fd;
            border-left: 4px solid #1e3c72;
            padding: 15px 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .info-banner-icon {
            font-size: 24px;
        }

        .info-banner-text {
            color: #333;
            font-size: 14px;
        }

        .controls {
            background: white;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            margin-bottom: 20px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .search-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        label {
            font-weight: 600;
            color: #555;
            font-size: 13px;
        }

        input {
            padding: 10px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 14px;
            transition: all 0.3s;
        }

        input:focus {
            outline: none;
            border-color: #1e3c72;
            box-shadow: 0 0 0 3px rgba(30, 60, 114, 0.1);
        }

        .table-container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            overflow-x: auto;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }

        thead {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
        }

        th {
            padding: 16px 20px;
            text-align: left;
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        th:nth-child(1) { width: 10%; }
        th:nth-child(2) { width: 10%; }
        th:nth-child(3) { width: 12%; }
        th:nth-child(4) { width: 48%; }
        th:nth-child(5) { width: 20%; }

        td {
            padding: 16px 20px;
            border-bottom: 1px solid #f0f0f0;
            color: #333;
            font-size: 15px;
            word-wrap: break-word;
        }

        tbody tr {
            transition: background 0.2s;
        }

        tbody tr:hover {
            background: #f0f4ff;
        }

        .no-data {
            text-align: center;
            padding: 40px;
            color: #999;
            font-size: 16px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #1e3c72;
            font-size: 18px;
        }

        .loading::after {
            content: '...';
            animation: dots 1.5s steps(4, end) infinite;
        }

        @keyframes dots {
            0%, 20% { content: '.'; }
            40% { content: '..'; }
            60%, 100% { content: '...'; }
        }

        .refresh-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(30, 60, 114, 0.95);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            display: none;
            align-items: center;
            gap: 10px;
        }

        .refresh-indicator.show {
            display: flex;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }

        @media (max-width: 768px) {
            .header {
                flex-direction: column;
                align-items: flex-start;
            }

            .controls {
                grid-template-columns: 1fr;
            }

            table {
                font-size: 11px;
                table-layout: auto;
            }

            th, td {
                padding: 10px 6px;
            }

            th:nth-child(1), td:nth-child(1) { 
                width: 15%;
                font-size: 12px;
            }
            th:nth-child(2), td:nth-child(2) { 
                width: 12%;
            }
            th:nth-child(3), td:nth-child(3) { 
                width: 15%;
            }
            th:nth-child(4), td:nth-child(4) { 
                width: 35%;
                font-size: 11px;
            }
            th:nth-child(5), td:nth-child(5) { 
                width: 23%;
                font-size: 10px;
            }

            th:nth-child(5) {
                font-size: 11px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>Baza Vozila</h1>
                <p>Vozila se beleze od 29.11.2025.</p>
            </div>

            <div class="stats">
                <div class="stat-box">
                    <span class="stat-number" id="totalVehicles">-</span>
                    <span class="stat-label">Ukupno vozila</span>
                </div>
                <div class="stat-box">
                    <span class="stat-number" id="totalRoutes">-</span>
                    <span class="stat-label">Linija</span>
                </div>
            </div>
        </div>

        <div class="controls">
            <div class="search-group">
                <label for="searchVehicle">Pretrazi vozilo:</label>
                <input type="text" id="searchVehicle" placeholder="Npr. P70618" oninput="filterTable()">
            </div>
            <div class="search-group">
                <label for="searchRoute">Pretrazi liniju:</label>
                <input type="text" id="searchRoute" placeholder="Npr. 601" oninput="filterTable()">
            </div>
            <div class="search-group">
                <label for="searchDeparture">Pretrazi polazak:</label>
                <input type="text" id="searchDeparture" placeholder="Npr. 12:31" oninput="filterTable()">
            </div>
            <div class="search-group">
                <label for="searchDirection">Pretrazi smer:</label>
                <input type="text" id="searchDirection" placeholder="Npr. Surcin" oninput="filterTable()">
            </div>
            <div class="search-group">
                <label for="sortBy">Sortiraj po:</label>
                <select id="sortBy" onchange="filterTable()" style="padding: 10px 15px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; cursor: pointer; background: white;">
                    <option value="vehicle">Broj vozila</option>
                    <option value="route">Broj linije</option>
                    <option value="recent">Najskorije viđeno</option>
                </select>
            </div>
        </div>

        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Vozilo</th>
                        <th>Linija</th>
                        <th>Polazak</th>
                        <th>Smer (ide ka)</th>
                        <th>Poslednji put viđen</th>
                    </tr>
                </thead>
                <tbody id="tableBody">
                    <tr>
                        <td colspan="5" class="loading">Ucitavam podatke</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>


    <script>
        let allData = [];

        async function loadData(silent = false) {
            const tbody = document.getElementById('tableBody');
            const refreshIndicator = document.getElementById('refreshIndicator');
            
            if (!silent) {
                tbody.innerHTML = '<tr><td colspan="5" class="loading">Ucitavam podatke</td></tr>';
            } else {
                refreshIndicator.classList.add('show');
            }

            try {
                const response = await fetch('/api/get-sheet-data');
                const data = await response.json();

                if (data.success && data.vehicles) {
                    // Dodaj rowIndex svakom vozilu
                    allData = data.vehicles.map((vehicle, index) => ({
                        ...vehicle,
                        rowIndex: index
                    }));
                    
                    // Sortiraj po broju vozila (default)
                    allData.sort((a, b) => {
                        const numA = parseInt(a.vozilo.replace(/\D/g, '')) || 0;
                        const numB = parseInt(b.vozilo.replace(/\D/g, '')) || 0;
                        return numA - numB;
                    });

                    renderTable(allData);
                    updateStats(allData);
                    
                    console.log(\`Ucitano \${allData.length} vozila iz baze\`);
                } else {
                    tbody.innerHTML = \`<tr><td colspan="5" class="no-data">\${data.message || 'Nema podataka'}</td></tr>\`;
                }
            } catch (error) {
                console.error('Greska:', error);
                if (!silent) {
                    tbody.innerHTML = '<tr><td colspan="5" class="no-data">Greska pri ucitavanju podataka</td></tr>';
                }
            } finally {
                setTimeout(() => {
                    refreshIndicator.classList.remove('show');
                }, 2000);
            }
        }

        function renderTable(data) {
            const tbody = document.getElementById('tableBody');
            
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="no-data">Nema rezultata</td></tr>';
                return;
            }

            const sortBy = document.getElementById('sortBy').value;
            const sortedData = [...data].sort((a, b) => {
                if (sortBy === 'route') {
                    const numA = parseInt(a.linija.replace(/\D/g, '')) || 0;
                    const numB = parseInt(b.linija.replace(/\D/g, '')) || 0;
                    return numA - numB;
                } else if (sortBy === 'recent') {
                    // Sortiraj po timestamp-u (najnoviji prvo)
                    return b.timestamp.localeCompare(a.timestamp);
                }
            });
        </script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
