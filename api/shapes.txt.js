import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), 'api', 'shapes.txt');
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(fileContent);
  } catch (error) {
    console.error('Error reading shapes.txt:', error);
    res.status(500).json({ error: 'Failed to load shapes data' });
  }
}
