export default async function handler(req, res) {
  // 1. Headers CORS y Checks Iniciales (Estilo coach.js)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Validación de Entrada
  const { image, mediaType } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: "Se requiere una imagen" });
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(mediaType)) {
    return res.status(400).json({ error: "Formato de imagen no soportado" });
  }

  // 3. Validación de Tamaño (Límite 5MB)
  // Base64 size approx: (chars * 3) / 4
  const sizeInBytes = (image.length * 3) / 4;
  if (sizeInBytes > 5 * 1024 * 1024) {
    return res.status(413).json({ error: "La imagen supera el límite de 5MB" });
  }

  // 4. Prompts de Visión
  const SYSTEM_PROMPT = `You analyze League of Legends screenshots (loading screens and champion select screens). You identify champions, their lanes, and which champion belongs to the user.

Respond ONLY with valid JSON. No markdown fences, no explanation, no commentary.`;

  const USER_PROMPT = `Analyze this League of Legends screenshot. It can be either a LOADING SCREEN or a CHAMPION SELECT screen.

── FINDING THE USER ──
Somewhere in the screenshot there is exactly ONE piece of text rendered in a golden/yellow color. Every other text is white or gray. That single golden text is the user's summoner name, and it is placed near the user's champion. The champion associated with that golden text is the user's champion.

Before writing the JSON, describe in a field called "debugGoldenText" what golden/yellow text you see and where it is located. Be precise about its position (e.g. "top row, 3rd card from the left" or "bottom row, rightmost card"). If you are not sure, say so.

── SCREEN TYPE ──
- "loading": two horizontal rows of 5 champion cards each. Below each card there is a text label. Exactly one label is golden/yellow — that label identifies the user. The user's team may be the top row or the bottom row (it depends on matchmaking — do not assume).
- "champion_select": vertical list with allies on the left (with lane labels in Spanish: SUPERIOR, JUNGLA, CENTRAL, INFERIOR, SOPORTE) and enemies on the right.

── WHAT TO RETURN ──
You must return three groups:
- "userChampion": the champion associated with the golden text, plus its lane.
- "allies": the 4 OTHER champions on the user's team (NOT the user), each with its lane.
- "enemies": the 5 champions on the opposing team, each with its lane.

"userChampion" + "allies" must total 5 champions. "enemies" must total 5. Never include the user's champion inside "allies".

── LANE VALUES ──
Use only these canonical lane codes: "top", "jgl", "mid", "adc", "sup".

For champion_select, read the Spanish lane label next to each ally and map it:
SUPERIOR → "top", JUNGLA → "jgl", CENTRAL → "mid", INFERIOR → "adc", SOPORTE → "sup".
For enemies in champion_select, infer lane from champion role and position as best you can.

For loading screen, infer each champion's lane from visual cues you can read in the image (Smite summoner spell icon = jungler; bot lane duo = adc + support; the remaining three split into top/mid and you decide from context). Do NOT assume any fixed positional order — in a loading screen champions are not guaranteed to be ordered top-jgl-mid-adc-sup on screen.

── CHAMPION NAMES ──
Return the BASE champion name, not the skin name. Examples: "Mordekaiser" not "Mordekaiser Pentakill"; "Shaco" not "Shaco Arcanista"; "Kled" not "Sir Kled"; "Warwick" not "Urfwick"; "Teemo" not "Beemo"; "Yuumi" not "Yuumiel".

Write champion names in Title Case with correct punctuation: "Shaco", "Vel'Koz", "Miss Fortune", "Jhin", "Kai'Sa", "Cho'Gath", "Kog'Maw", "Rek'Sai", "Kha'Zix".

── JSON FORMAT ──
Respond with EXACTLY this JSON structure, no markdown:
{
  "debugGoldenText": "describe the golden/yellow text and its location",
  "screenType": "loading" | "champion_select",
  "userChampion": { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
  "allies": [
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" }
  ],
  "enemies": [
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" },
    { "champion": "ChampionName", "lane": "top" | "jgl" | "mid" | "adc" | "sup" }
  ],
  "confidence": "high" | "medium" | "low"
}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s para dar margen a Vercel (60s limit)

  try {
    // 5. Llamada a Anthropic Vision (modelo exacto de coach.js)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: image
                }
              },
              {
                type: "text",
                text: USER_PROMPT
              }
            ]
          }
        ],
      }),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || "Error de comunicación con la IA" });
    }

    const aiText = data.content?.map(i => i.text || "").join("\n") || "";

    // 6. Parsing Robust (Patrón optimizado)
    const firstBrace = aiText.indexOf("{");
    let depth = 0;
    let lastBrace = -1;

    if (firstBrace !== -1) {
      for (let i = firstBrace; i < aiText.length; i++) {
        if (aiText[i] === "{") depth++;
        else if (aiText[i] === "}") {
          depth--;
          if (depth === 0) {
            lastBrace = i;
            break;
          }
        }
      }
    }

    if (lastBrace === -1) {
      return res.status(500).json({ error: "No se pudo interpretar la imagen" });
    }

    const parsedJson = JSON.parse(aiText.slice(firstBrace, lastBrace + 1));
    return res.status(200).json(parsedJson);

  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "La solicitud excedió el tiempo límite (timeout)." });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    clearTimeout(timeout);
  }
}
