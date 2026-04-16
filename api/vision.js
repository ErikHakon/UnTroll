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
  const SYSTEM_PROMPT = `You are a League of Legends expert analyzing a loading screen screenshot.

LAYOUT OF THE LOADING SCREEN:
- There are 2 rows of 5 champion cards each.
- Top row = blue team (ally team), bottom row = red team (enemy team).
- Within each row, cards are ordered LEFT TO RIGHT as: top, jungle, mid, adc, support.
- Each card has: a large portrait, the skin name above, and the CHAMPION NAME in 
  bold white text below the portrait. Always read that bold text to get the champion name.
- Below the champion name is the summoner name. 
  The user's summoner name is highlighted in YELLOW or GOLDEN color.

YOUR TASKS:
1. Read the bold white champion name text under each portrait for all 10 champions.
2. Assign lanes by horizontal position left-to-right: 1st=top, 2nd=jungle, 3rd=mid, 4th=adc, 5th=support.
3. Identify the user's champion by finding the golden/yellow summoner name — 
   read the bold champion name directly above that golden text.

Respond ONLY with valid JSON, no markdown, no explanation.`;

  const USER_PROMPT = `Analyze this League of Legends loading screen.

Top row = blue team (5 champions, left to right: top, jungle, mid, adc, support).
Bottom row = red team (5 champions, left to right: top, jungle, mid, adc, support).

For each champion card: read the bold white text below the portrait — that is the champion name.
Find the golden/yellow summoner name — the bold text just above it is the user's champion.

Respond with this exact JSON:
{
  "userChampion": {
    "champion": "ChampionName",
    "lane": "top|jungle|mid|adc|support"
  },
  "allies": [
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" }
  ],
  "enemies": [
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" },
    { "champion": "ChampionName", "lane": "top|jungle|mid|adc|support" }
  ],
  "confidence": "high|medium|low"
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
