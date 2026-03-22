const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');

// ── Language maps ──────────────────────────────────────────────────────────
//  Judge0 language_id → JDoodle { language, versionIndex }
const LANGUAGE_MAP = {
  93: { name: 'JavaScript (Node.js)', jdoodle: { language: 'nodejs',     versionIndex: '4' } },
  71: { name: 'Python 3',             jdoodle: { language: 'python3',    versionIndex: '4' } },
  54: { name: 'C++ (GCC 17)',         jdoodle: { language: 'cpp17',      versionIndex: '1' } },
  62: { name: 'Java',                 jdoodle: { language: 'java',       versionIndex: '4' } },
  60: { name: 'Go',                   jdoodle: { language: 'go',         versionIndex: '4' } },
  73: { name: 'Rust',                 jdoodle: { language: 'rust',       versionIndex: '4' } },
  50: { name: 'C (GCC)',              jdoodle: { language: 'c',          versionIndex: '5' } },
  94: { name: 'TypeScript',           jdoodle: { language: 'typescript', versionIndex: '1' } },
};
const VALID_IDS = new Set(Object.keys(LANGUAGE_MAP).map(Number));

// ── Config ─────────────────────────────────────────────────────────────────
const LOCAL_JUDGE0_URL = (process.env.JUDGE0_URL || 'http://localhost:2358').replace(/\/$/, '');
const JDOODLE_CLIENT_ID     = process.env.JDOODLE_CLIENT_ID     || '';
const JDOODLE_CLIENT_SECRET = process.env.JDOODLE_CLIENT_SECRET || '';
const JDOODLE_URL           = 'https://api.jdoodle.com/v1/execute';

// ── Helpers ────────────────────────────────────────────────────────────────
const toBase64   = (str) => Buffer.from(str).toString('base64');
const fromBase64 = (str) => (str ? Buffer.from(str, 'base64').toString('utf-8') : '');
const sleep      = (ms)  => new Promise((r) => setTimeout(r, ms));

// ── Engine 1: Local Docker Judge0  ─────────────────────────────────────────
async function runOnLocalJudge0(source_code, language_id, stdin) {
  // Submit
  const submitRes = await fetch(
    `${LOCAL_JUDGE0_URL}/submissions?base64_encoded=true&wait=false`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: toBase64(source_code),
        language_id: Number(language_id),
        ...(stdin ? { stdin: toBase64(stdin) } : {}),
      }),
      signal: AbortSignal.timeout(4000), // fast fail — don't wait long on Windows
    }
  );

  if (!submitRes.ok) {
    throw new Error(`Local Judge0 submit ${submitRes.status}: ${await submitRes.text()}`);
  }

  const { token } = await submitRes.json();
  if (!token) throw new Error('Local Judge0 returned no token');

  // Poll up to 15s
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const pollRes = await fetch(
      `${LOCAL_JUDGE0_URL}/submissions/${token}?base64_encoded=true&fields=stdout,stderr,compile_output,status,time,memory`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!pollRes.ok) throw new Error(`Local Judge0 poll ${pollRes.status}`);

    const data     = await pollRes.json();
    const statusId = data?.status?.id;
    console.log(`[Execute/LocalJudge0] attempt=${i + 1} statusId=${statusId}`);

    if (statusId && statusId >= 3) {
      if (statusId === 13) throw new Error('Local Judge0 Internal Error (cgroup/sandbox unavailable on Windows Docker)');
      return {
        stdout:         fromBase64(data.stdout),
        stderr:         fromBase64(data.stderr),
        compile_output: fromBase64(data.compile_output),
        status:         data.status,
        time:           data.time,
        memory:         data.memory,
        engine:         'Judge0 (local Docker)',
      };
    }
  }
  throw new Error('Local Judge0 timed out after 15s');
}

// ── Engine 2: JDoodle (free cloud fallback) ───────────────────────────────
async function runOnJDoodle(source_code, language_id, stdin) {
  const lang = LANGUAGE_MAP[language_id];
  if (!lang?.jdoodle) throw new Error(`No JDoodle mapping for language_id ${language_id}`);

  const res = await fetch(JDOODLE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId:     JDOODLE_CLIENT_ID,
      clientSecret: JDOODLE_CLIENT_SECRET,
      script:       source_code,
      stdin:        stdin || '',
      language:     lang.jdoodle.language,
      versionIndex: lang.jdoodle.versionIndex,
    }),
    signal: AbortSignal.timeout(20000),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(`JDoodle ${res.status}: ${data.error || JSON.stringify(data)}`);
  }

  // JDoodle returns { output, statusCode, memory, cpuTime }
  //  statusCode 200 = success, 400/500 = runtime errors
  const output    = data.output || '';
  const isSuccess = res.ok && data.statusCode === 200 && !output.includes('JDoodle: ');

  // JDoodle doesn't separate stdout/stderr — everything is in output
  // Detect compile errors by keywords
  const isCompileErr =
    output.includes('error:') ||
    output.includes('SyntaxError') ||
    output.includes('cannot find symbol') ||
    output.includes('undefined reference');

  return {
    stdout:         isSuccess && !isCompileErr ? output : '',
    stderr:         !isSuccess && !isCompileErr ? output : '',
    compile_output: isCompileErr ? output : '',
    status: {
      id: isSuccess && !isCompileErr ? 3 : (isCompileErr ? 6 : 4),
      description: isSuccess && !isCompileErr
        ? 'Accepted'
        : isCompileErr ? 'Compilation Error' : 'Runtime Error',
    },
    time:   data.cpuTime  ? String(data.cpuTime)  : null,
    memory: data.memory   ? String(data.memory)   : null,
    engine: 'JDoodle (cloud)',
  };
}

// ── POST /api/execute ──────────────────────────────────────────────────────
router.post('/', protect, async (req, res) => {
  const { source_code, language_id, stdin } = req.body;

  // Validation
  if (!source_code || typeof source_code !== 'string' || !source_code.trim()) {
    return res.status(400).json({ error: 'source_code is required.' });
  }
  if (!language_id || !VALID_IDS.has(Number(language_id))) {
    return res.status(400).json({ error: `Invalid language_id: ${language_id}. Supported: ${[...VALID_IDS].join(', ')}` });
  }

  // ── Try local Judge0 first ─────────────────────────────────────────────
  try {
    console.log(`[Execute] Trying local Judge0 for language_id=${language_id}...`);
    const result = await runOnLocalJudge0(source_code, language_id, stdin);
    console.log(`[Execute] Local Judge0 success — ${result.status?.description}`);
    return res.json(result);
  } catch (err) {
    console.warn(`[Execute] Local Judge0 failed: ${err.message}`);
  }

  // ── Fall back to JDoodle ───────────────────────────────────────────────
  if (!JDOODLE_CLIENT_ID || !JDOODLE_CLIENT_SECRET) {
    return res.status(502).json({
      error:
        'Local Judge0 sandbox is unavailable (Docker cgroup issue on Windows). ' +
        'Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET to server/.env to enable the free cloud fallback. ' +
        'Get free credentials at https://www.jdoodle.com/compiler-api (200 runs/day free)',
    });
  }

  try {
    console.log(`[Execute] Trying JDoodle for language_id=${language_id}...`);
    const result = await runOnJDoodle(source_code, language_id, stdin);
    console.log(`[Execute] JDoodle success — ${result.status?.description}`);
    return res.json(result);
  } catch (err) {
    console.error(`[Execute] JDoodle failed: ${err.message}`);
    return res.status(502).json({
      error: `All execution engines failed. JDoodle error: ${err.message}`,
    });
  }
});

module.exports = router;
