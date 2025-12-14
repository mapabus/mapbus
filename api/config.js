export default function handler(req, res) {
  const isAuthenticated = req.session?.user || req.cookies?.authToken;
  
  if (!isAuthenticated) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', 'application/json');


  res.status(200).json({
    refreshInterval: 60000,
    mapCenter: [44.8125, 20.4612],
    mapZoom: 13,
    colors: [
      '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#f1c40f', 
      '#e67e22', '#1abc9c', '#34495e', '#d35400', '#c0392b',
      '#2980b9', '#8e44ad', '#27ae60', '#f39c12', '#16a085'
    ]
  });
}
