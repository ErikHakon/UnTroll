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
  const SYSTEM_PROMPT = `You are a League of Legends expert analyzing a screenshot.
In a League of Legends LOADING SCREEN, champions are ALWAYS displayed in this 
exact vertical order, top to bottom:
  Position 1 = TOP
  Position 2 = JUNGLE
  Position 3 = MID
  Position 4 = ADC (bot carry)
  Position 5 = SUPPORT

Use this positional order as the PRIMARY method to assign lanes.
Only override it if the champion is universally known to never play that role
(e.g. Soraka at position 2 → still JUNGLE by position, don't override).
The user's champion is identified by their summoner name in yellow/golden color.
Respond ONLY with valid JSON, no markdown, no explanation.`;

  const USER_PROMPT = `Analyze this League of Legends loading screen screenshot.
Both teams show 5 champions each, listed vertically top to bottom.
Assign lanes strictly by vertical position:
  1st champion (topmost) = top
  2nd champion = jungle
  3rd champion = mid
  4th champion = adc
  5th champion (bottommost) = support

Identify which champion has the summoner name highlighted in yellow/gold — 
that is the user's champion.

Respond with this exact JSON structure:
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
