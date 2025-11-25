import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Učitaj route-mapping.json
const routeMappingPath = path.join(__dirname, 'public', 'route-mapping.json');
const routeMapping = JSON.parse(fs.readFileSync(routeMappingPath, 'utf-8'));

const BASE_URL = 'https://www.bgprevoz.rs/linije/red-voznje';

async function fetchRouteCoordinates(browser, routeId, direction) {
    const url = `${BASE_URL}/smer-${direction. toLowerCase()}/${routeId}`;
    console.log(`Fetching: ${url}`);
    
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Sačekaj da se mapa učita
        await page. waitForSelector('.leaflet-pane', { timeout: 10000 });
        
        // Izvuci koordinate polyline-a iz Leaflet mape
        const coordinates = await page.evaluate(() => {
            // Leaflet čuva polyline podatke u _layers objektu mape
            const mapContainer = document.querySelector('. leaflet-container');
            if (!mapContainer || !mapContainer._leaflet_id) return null;
            
            // Pronađi mapu preko globalnog L objekta
            const mapId = mapContainer._leaflet_id;
            
            // Alternativni pristup - izvuci SVG path podatke
            const pathElements = document.querySelectorAll('. leaflet-overlay-pane path');
            if (pathElements.length === 0) return null;
            
            // Pokušaj da pronađeš polyline koordinate kroz window objekte
            if (window.map && window.map.eachLayer) {
                const coords = [];
                window.map.eachLayer(layer => {
                    if (layer. getLatLngs) {
                        const latlngs = layer.getLatLngs();
                        if (latlngs && latlngs.length > 0) {
                            coords.push(...latlngs. map(ll => [ll. lat, ll.lng]));
                        }
                    }
                });
                if (coords.length > 0) return coords;
            }
            
            return null;
        });
        
        await page.close();
        return coordinates;
        
    } catch (error) {
        console.error(`Error fetching ${url}:`, error. message);
        await page.close();
        return null;
    }
}

async function main() {
    console.log('Starting route fetcher...');
    console.log(`Found ${Object.keys(routeMapping).length} routes to process`);
    
    const browser = await puppeteer. launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const routesData = {};
    const directions = ['a', 'b'];
    
    // Obradi svaku liniju
    for (const [routeId, displayName] of Object. entries(routeMapping)) {
        console.log(`\nProcessing route ${displayName} (ID: ${routeId})`);
        routesData[routeId] = {};
        
        for (const direction of directions) {
            const coords = await fetchRouteCoordinates(browser, routeId, direction);
            if (coords && coords.length > 0) {
                routesData[routeId][direction. toUpperCase()] = coords;
                console.log(`  Smer ${direction. toUpperCase()}: ${coords.length} points`);
            } else {
                console.log(`  Smer ${direction. toUpperCase()}: No data`);
            }
            
            // Pauza između zahteva da ne opteretimo server
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    await browser.close();
    
    // Sačuvaj rezultate
    const outputPath = path. join(__dirname, 'public', 'routes-data.json');
    fs. writeFileSync(outputPath, JSON.stringify(routesData, null, 2), 'utf-8');
    console.log(`\nRoutes data saved to ${outputPath}`);
    console.log(`Total routes processed: ${Object. keys(routesData).length}`);
}

main().catch(console.error);
