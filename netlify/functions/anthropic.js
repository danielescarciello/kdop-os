/* Proxy server-side verso l'API Anthropic.
   Serve a due cose: aggirare il CORS del browser e, soprattutto,
   tenere la chiave fuori dal bundle JavaScript, dove chiunque
   aprirebbe il devtools e se la porterebbe via. */
export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo non consentito" }, 405);
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return json({ error: "ANTHROPIC_API_KEY non configurata su Netlify" }, 500);
  }

  try {
    const body = await req.text();
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body,
    });
    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", ...cors() },
    });
  } catch (e) {
    return json({ error: "Errore nella chiamata upstream" }, 502);
  }
};

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const json = (o, status) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...cors() } });

export const config = { path: "/api/anthropic" };
