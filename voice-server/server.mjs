import { createServer } from 'node:http';

const key = process.env.ELEVENLABS_API_KEY;
const token = process.env.VOICE_SERVER_TOKEN;
if (!key || !token) throw new Error('Set ELEVENLABS_API_KEY and VOICE_SERVER_TOKEN in .env.local.');
const limit = 8 * 1024 * 1024;
let active = false;
createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST' || req.url !== '/transcribe') return reply(404, { error: 'Not found' });
  if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: 'Unauthorized' });
  if (active) return reply(429, { error: 'Transcription busy; try again shortly.' });
  active = true;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) { reply(413, { error: 'Recording exceeds 8 MB.' }); return; }
      chunks.push(chunk);
    }
    if (!size) return reply(400, { error: 'Empty recording.' });
    const form = new FormData();
    form.append('file', new Blob(chunks, { type: 'audio/mp4' }), 'recording.m4a');
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'eng');
    form.append('tag_audio_events', 'false');
    const upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST', headers: { 'xi-api-key': key }, body: form,
      signal: AbortSignal.timeout(60000),
    });
    if (!upstream.ok) return reply(502, { error: `ElevenLabs transcription failed (${upstream.status}).` });
    const result = await upstream.json();
    if (typeof result.text !== 'string') throw new Error('Missing transcript');
    reply(200, { text: result.text });
  } catch {
    reply(502, { error: 'Transcription failed or timed out. Try again.' });
  } finally { active = false; }
}).listen(Number(process.env.PORT || 8787), process.env.HOST || '127.0.0.1', () => {
  console.log('Voice transcription server listening on port ' + (process.env.PORT || 8787));
});
