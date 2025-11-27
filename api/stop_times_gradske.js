export default async function handler(req, res) {
    // ID fajla izvučen iz tvog linka
    const fileId = '1qD-zB1TljR9Ii5CJB5XW0wW4VZNdVQZs';
    // URL za direktno preuzimanje sa Google Drive-a
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    try {
        const response = await fetch(driveUrl);

        if (!response.ok) {
            throw new Error(`Google Drive error: ${response.statusText}`);
        }

        // Učitavamo sadržaj kao tekst
        const csvData = await response.text();

        // Postavljamo headers da browser zna da je ovo tekstualni fajl (CSV)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Keširanje na 1h da ne udaraš limit na Drive-u
        
        // Šaljemo podatke nazad
        res.status(200).send(csvData);

    } catch (error) {
        console.error('Greška pri dohvatanju stop_times:', error);
        res.status(500).json({ error: 'Neuspešno učitavanje podataka sa Drive-a' });
    }
}
