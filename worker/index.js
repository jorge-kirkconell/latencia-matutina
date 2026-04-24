/**
 * Cloudflare Worker — Proxy seguro para escritura en GitHub API
 * Latencia Matutina v1.0
 *
 * Variables de entorno requeridas (en Cloudflare Dashboard → Workers → Settings → Variables):
 *   GITHUB_TOKEN  — Personal Access Token con permisos: contents:write
 *   GITHUB_OWNER  — Usuario o org de GitHub
 *   GITHUB_REPO   — Nombre del repositorio
 *   GITHUB_BRANCH — Rama principal (default: main)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const GITHUB_TOKEN  = env.GITHUB_TOKEN;
    const GITHUB_OWNER  = env.GITHUB_OWNER;
    const GITHUB_REPO   = env.GITHUB_REPO;
    const GITHUB_BRANCH = env.GITHUB_BRANCH || 'main';
    const API_BASE      = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

    const ghHeaders = {
      Authorization: `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'LatenciaMatutina/1.0',
      Accept: 'application/vnd.github.v3+json',
    };

    // Helper: read a file from GitHub
    async function readFile(path) {
      const res = await fetch(`${API_BASE}/${path}?ref=${GITHUB_BRANCH}`, { headers: ghHeaders });
      if (!res.ok) throw new Error(`GitHub read error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      return {
        content: JSON.parse(atob(data.content.replace(/\n/g, ''))),
        sha: data.sha,
      };
    }

    // Helper: write a file to GitHub
    async function writeFile(path, content, sha, message) {
      const body = {
        message,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
        sha,
        branch: GITHUB_BRANCH,
      };
      const res = await fetch(`${API_BASE}/${path}`, {
        method: 'PUT',
        headers: ghHeaders,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`GitHub write error ${res.status}: ${await res.text()}`);
      return res.json();
    }

    try {
      const url = new URL(request.url);

      // ── GET: Read a file ───────────────────────────────────────────────
      if (request.method === 'GET') {
        const path = url.searchParams.get('path');
        if (!path) return json({ error: 'Falta el parámetro path' }, 400);
        const { content, sha } = await readFile(path);
        return json({ content, sha });
      }

      // ── POST: Authenticated write ──────────────────────────────────────
      if (request.method === 'POST') {
        const body = await request.json();
        const { collaboratorToken, action, payload } = body;

        if (!collaboratorToken) return json({ error: 'Token requerido' }, 401);

        // Validate collaborator token
        const { content: team } = await readFile('data/team.json');
        const member = team.members.find(m => m.token === collaboratorToken && m.active);
        if (!member) return json({ error: 'Token no válido o colaborador inactivo' }, 401);

        // ── Action: add_record ──────────────────────────────────────────
        if (action === 'add_record') {
          const { content: recordsData, sha } = await readFile('data/records.json');
          recordsData.records.push(payload);
          await writeFile('data/records.json', recordsData, sha, `Registro de llegada: ${member.name} — ${payload.date}`);
          return json({ success: true, member: { id: member.id, name: member.name } });
        }

        // ── Action: update_record ────────────────────────────────────────
        if (action === 'update_record') {
          const { recordId, updates } = payload;
          const { content: recordsData, sha } = await readFile('data/records.json');
          const idx = recordsData.records.findIndex(r => r.id === recordId);
          if (idx === -1) return json({ error: 'Registro no encontrado' }, 404);

          // Prevent self-verification
          if (updates.verifiedBy && updates.verifiedBy === recordsData.records[idx].memberId) {
            return json({ error: 'No puedes verificar tu propio registro' }, 403);
          }

          recordsData.records[idx] = { ...recordsData.records[idx], ...updates };
          await writeFile('data/records.json', recordsData, sha, `Actualización de registro #${recordId}`);
          return json({ success: true });
        }

        // ── Action: add_payment ──────────────────────────────────────────
        if (action === 'add_payment') {
          const { content: paymentsData, sha } = await readFile('data/payments.json');
          paymentsData.payments.push(payload);
          await writeFile('data/payments.json', paymentsData, sha, `Pago registrado: ${payload.debtorName}`);
          return json({ success: true });
        }

        // ── Action: update_team (admin only) ─────────────────────────────
        if (action === 'update_team') {
          if (member.role !== 'admin') return json({ error: 'Solo administradores pueden modificar el equipo' }, 403);
          const { content: teamData, sha } = await readFile('data/team.json');
          const updatedTeam = payload;
          await writeFile('data/team.json', updatedTeam, sha, 'Actualización del equipo');
          return json({ success: true });
        }

        return json({ error: `Acción desconocida: ${action}` }, 400);
      }

      return json({ error: 'Método no permitido' }, 405);

    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}
