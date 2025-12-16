export async function onRequest(context) {
  const req = context.request;
  const url = new URL(req.url);
  const fileType = url.searchParams.get('file') || 'default';

  try {
    let filePath;
    if (fileType === 'gradske') {
      filePath = '/data/shapes_gradske.txt';
    } else {
      filePath = '/data/shapes.txt';
    }

    const origin = url.origin;
    const fileContent = await fetch(`${origin}${filePath}`).then(r => {
      if (!r.ok) throw new Error('File not found');
      return r.text();
    });

    const headers = new Headers({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    });

    return new Response(fileContent, { status: 200, headers });
  } catch (error) {
    console.error('Error reading shapes file:', error);
    return new Response(JSON.stringify({ error: 'Failed to load shapes data', file: fileType, details: error.message }), { status: 500 });
  }
}