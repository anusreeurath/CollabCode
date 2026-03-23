const express = require('express');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// ── Groq REST config ──────────────────────────────────────────────────────────
// Groq is free (no credit card), generous quota, and very fast.
// Get a free API key at: https://console.groq.com → API Keys → Create Key
// Model: llama-3.1-8b-instant — fast, free tier, great for error explanations.
const GROQ_MODEL   = 'llama-3.1-8b-instant';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ── In-memory rate limit: 1 call per roomId per 10 seconds ───────────────────
const lastCallMap = new Map();

// ── POST /api/explain ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { error, code, language, roomId } = req.body;

  if (!error || !code || !language) {
    return res.status(400).json({ error: 'error, code, and language are required' });
  }

  // Per-room rate limit: 1 request per 10 seconds
  if (roomId) {
    const last    = lastCallMap.get(roomId) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < 10_000) {
      const wait = Math.ceil((10_000 - elapsed) / 1000);
      return res.status(429).json({ error: `Please wait ${wait}s before explaining again.` });
    }
    lastCallMap.set(roomId, Date.now());
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'GROQ_API_KEY is not set. Get a free key at https://console.groq.com',
    });
  }

  // ── Set up SSE ────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const groqRes = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:  GROQ_MODEL,
        stream: true,
        messages: [
          {
            role: 'system',
            content:
              'You are a concise coding assistant. The user got an error while running code. ' +
              'Explain what caused this error in 2-3 plain English sentences. ' +
              'Then give the exact fix as a short code snippet. ' +
              'Do not give long explanations. Be direct.',
          },
          {
            role: 'user',
            content: `Language: ${language}\n\nCode:\n${code}\n\nError:\n${error}`,
          },
        ],
        temperature: 0.3,
        max_tokens:  512,
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text();
      console.error('[POST /explain] Groq HTTP error:', groqRes.status, errBody);
      res.write(`data: ${JSON.stringify({ error: `Groq ${groqRes.status}: ${groqRes.statusText}` })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // ── Stream OpenAI-format SSE chunks from Groq → client ────────────────
    const reader  = groqRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const text   = parsed?.choices?.[0]?.delta?.content;
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[POST /explain]', err);
    res.write(`data: ${JSON.stringify({ error: err.message || 'Groq request failed' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

module.exports = router;
