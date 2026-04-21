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
  const SYSTEM_PROMPT = `You analyze League of Legends screenshots. 
Respond with valid JSON only. No markdown, no explanation.`;

  const USER_PROMPT = `This is a League of Legends screenshot. Extract information about the 10 champions in the match and identify which one belongs to the user.

FINDING THE USER'S CHAMPION:
Somewhere in this screenshot there is exactly one piece of text rendered in a golden/yellow color. Every other text in the screenshot is white or gray. That single golden text is the user's summoner name, and it appears near the user's champion card. The champion associated with that golden text is the user's champion.

Identify all 10 champions and assign each one a lane role. Return only the base champion name, never the skin name. For example: "Mordekaiser" not "Mordekaiser Pentakill", "Shaco" not "Shaco Arcanista", "Kled" not "Sir Kled", "Warwick" not "Urfwick", "Teemo" not "Beemo", "Yuumi" not "Yuumiel".
Mark which champion belongs to the user (yellow/gold username).

Before giving your JSON answer, describe exactly what golden/yellow colored text you see in the image and where it is located. Include this description in a field called "debugGoldenText" in the JSON response.

Identify the screen type:
- "loading": two horizontal rows of 5 champion cards. Below each card's summoner icon there is a text label. Exactly one of these 10 labels is rendered in golden/yellow color — that label identifies the user. All other 9 labels are white or gray. The champion of the card with the golden label is the userChampion. The user's team (aliados) can be either the top row or the bottom row; place the user's team in blueTeam and the other row in redTeam.
- "champion_select": vertical list with allies on the left (with lane labels) and enemies on the right

For champion_select, read the lane labels next to each ally and map them: SUPERIOR/TOP → "top", JUNGLA/JUNGLE → "jgl", CENTRAL/MID → "mid", INFERIOR/ADC/BOT → "adc", SOPORTE/SUPPORT → "sup". For loading screen, set blueLanes to null.

Champion names must be in Title Case: "Shaco", "Vel'Koz", "Miss Fortune", "Jhin".

Respond with this exact JSON, no markdown:
{
  "debugGoldenText": "describe what golden/yellow text you see and where",
  "userChampion": "ChampionName",
  "screenType": "loading" | "champion_select",
  "blueTeam": ["Champion1", "Champion2", "Champion3", "Champion4", "Champion5"],
  "redTeam": ["Champion1", "Champion2", "Champion3", "Champion4", "Champion5"],
  "blueLanes": ["top", "jgl", "mid", "adc", "sup"] or null,
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
