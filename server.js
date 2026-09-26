import express from 'express';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Supabase client ── */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY   // use service-role key so we can bypass RLS
);

/* ── CORS + JSON ── */
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin',  '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

/* ─────────────────────────────────────────────────
   AUTH MIDDLEWARE
───────────────────────────────────────────────── */
function requireAuth(req, res, next) {
  try {
    const raw = req.headers.authorization?.split(' ')[1];
    const payload = jwt.verify(raw, process.env.JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

/* ─────────────────────────────────────────────────
   POST /auth/register
───────────────────────────────────────────────── */
app.post('/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
  if (password.length < 8)  return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hash     = await bcrypt.hash(password, 10);
  const mcpToken = 'dt-' + randomUUID().replace(/-/g, '').slice(0, 24);

  const { data: user, error } = await supabase
    .from('users')
    .insert({ name: name || email.split('@')[0], email, password_hash: hash, bob_mcp_token: mcpToken })
    .select('id,name,email,bob_mcp_token,created_at')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    return res.status(400).json({ error: error.message });
  }

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ user, token });
});

/* ─────────────────────────────────────────────────
   POST /auth/login
───────────────────────────────────────────────── */
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const { data: user, error } = await supabase
    .from('users')
    .select('id,name,email,password_hash,bob_mcp_token,created_at')
    .eq('email', email)
    .single();

  if (error || !user) return res.status(401).json({ error: 'Invalid email or password' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match)  return res.status(401).json({ error: 'Invalid email or password' });

  const { password_hash: _, ...safeUser } = user;
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.json({ user: safeUser, token });
});

/* ─────────────────────────────────────────────────
   POST /auth/regen-token  (regenerate MCP token)
───────────────────────────────────────────────── */
app.post('/auth/regen-token', requireAuth, async (req, res) => {
  const newToken = 'dt-' + randomUUID().replace(/-/g, '').slice(0, 24);
  const { error } = await supabase
    .from('users')
    .update({ bob_mcp_token: newToken })
    .eq('id', req.userId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ bob_mcp_token: newToken });
});

/* ─────────────────────────────────────────────────
   POST /snapshots  (upsert)
───────────────────────────────────────────────── */
app.post('/snapshots', requireAuth, async (req, res) => {
  const { snapshots } = req.body || {};
  if (!Array.isArray(snapshots) || snapshots.length === 0)
    return res.status(400).json({ error: 'snapshots array is required' });

  const rows = snapshots.map(s => ({
    id:          s.id,
    user_id:     req.userId,
    file:        s.file        || '',
    type:        s.type        || 'red',
    description: s.description || s.desc || '',
    code:        s.code        || '',
    prompt:      s.prompt      || '',
    ts:          s.ts          || '',
    ts_ms:       s.ts_ms       || s.tsMs || Date.now(),
  }));

  const { error } = await supabase.from('snapshots').upsert(rows, { onConflict: 'id' });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ saved: rows.length });
});

/* ─────────────────────────────────────────────────
   GET /snapshots
───────────────────────────────────────────────── */
app.get('/snapshots', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('snapshots')
    .select('id,file,type,description,code,prompt,ts,ts_ms,created_at')
    .eq('user_id', req.userId)
    .order('ts_ms', { ascending: false })
    .limit(200);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ snapshots: data || [] });
});

/* ═══════════════════════════════════════════════════
   MCP ENDPOINT  — Bob connects here
   Transport: Streamable HTTP  (MCP 2024-11-05)
═══════════════════════════════════════════════════ */
app.post('/mcp', async (req, res) => {
  const body = req.body;
  const id   = body?.id ?? null;

  /* ── initialize ── */
  if (body?.method === 'initialize') {
    return res.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'devtwin-mcp', version: '1.0.0' },
      },
    });
  }

  /* ── notifications/initialized (no response needed) ── */
  if (body?.method === 'notifications/initialized') {
    return res.sendStatus(204);
  }

  /* ── tools/list ── */
  if (body?.method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0', id,
      result: {
        tools: [
          {
            name: 'get_my_snapshots',
            description:
              "Returns the authenticated developer's latest DevTwin snapshots " +
              "(code state + prompt + timestamp). Requires a valid DevTwin MCP token " +
              "in the Authorization header.",
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Maximum number of snapshots to return (default: 5, max: 20)',
                },
                type: {
                  type: 'string',
                  enum: ['red', 'green', 'all'],
                  description: 'Filter by snapshot type: red = planning, green = execution, all = both',
                },
              },
            },
          },
        ],
      },
    });
  }

  /* ── tools/call ── */
  if (body?.method === 'tools/call') {
    const toolName = body.params?.name;
    if (toolName !== 'get_my_snapshots') {
      return res.json({
        jsonrpc: '2.0', id,
        error: { code: -32601, message: 'Unknown tool: ' + toolName },
      });
    }

    /* validate MCP token from Authorization header */
    const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!bearerToken) {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: '❌ No MCP token provided. Open DevTwin → Profile → Copy MCP Config for Bob.',
          }],
        },
      });
    }

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id,name,email')
      .eq('bob_mcp_token', bearerToken)
      .single();

    if (userErr || !user) {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: '❌ Invalid or expired MCP token. Regenerate it in DevTwin → Profile.',
          }],
        },
      });
    }

    const args   = body.params?.arguments || {};
    const limit  = Math.min(Number(args.limit) || 5, 20);
    const filter = args.type || 'all';

    let query = supabase
      .from('snapshots')
      .select('id,file,type,description,prompt,code,ts,ts_ms')
      .eq('user_id', user.id)
      .order('ts_ms', { ascending: false })
      .limit(limit);

    if (filter !== 'all') query = query.eq('type', filter);

    const { data: snaps } = await query;

    if (!snaps || snaps.length === 0) {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{
            type: 'text',
            text: `👋 Hi ${user.name}! No DevTwin snapshots found yet.\nGo to DevTwin → Prompt Studio, generate a prompt, and click Snapshot.`,
          }],
        },
      });
    }

    const text = [
      `📸 DevTwin Snapshots for ${user.name} (${user.email})`,
      `Total: ${snaps.length} snapshot(s) shown\n`,
      ...snaps.map((s, i) =>
        `━━━ #${i + 1} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📁 File: ${s.file}\n` +
        `🕐 Time: ${s.ts}\n` +
        `${s.type === 'red' ? '🔴 Planning' : '🟢 Execution'}\n` +
        `📝 ${s.description}\n` +
        (s.prompt ? `\n🤖 Prompt:\n${s.prompt}` : `\n💾 Code:\n${(s.code || '').slice(0, 600)}`)
      ),
    ].join('\n');

    return res.json({
      jsonrpc: '2.0', id,
      result: { content: [{ type: 'text', text }] },
    });
  }

  /* ── fallback ── */
  res.json({ jsonrpc: '2.0', id, result: {} });
});

/* ── health check ── */
app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`DevTwin backend running on port ${PORT}`);
});
